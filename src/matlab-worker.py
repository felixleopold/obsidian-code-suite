"""Persistent MATLAB Engine worker for Code Suite.

The process stdout is reserved for newline-delimited JSON. The host starts one
worker per note with::

    python matlab-worker.py --session-dir DIR [--cwd DIR]

Host messages::

    {"type":"run","id":ID,"code":"...","imageDir":"..."}
    {"type":"cancel","id":ID,"reason":"user"|"timeout"}
    {"type":"shutdown"}

Worker messages::

    {"type":"ready","release":"2026a"}
    {"type":"stdout"|"stderr","id":ID,"data":"...",
     "executionDone":bool?}
    {"type":"done","id":ID,"exitCode":0|1|null,
     "killed":bool,"cancelled":bool,
     "figures":[{"path":"...","figureIndex":1}]}
    {"type":"fatal","message":"..."}

The stdin reader only parses JSON and queues commands. All Engine and
FutureResult methods are called by the main thread.
"""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import queue
import re
import secrets
import sys
import threading
from dataclasses import dataclass
from typing import Any, TextIO


POLL_SECONDS = 0.05
CAPTURE_FUNCTION = "codesuite_internal_capture_7d9b21"
FUNCTION_HEADER_RE = re.compile(
    r"^\s*function\b\s*"
    r"(?:(?:\[[^\]\r\n]*\]|[A-Za-z][A-Za-z0-9_]*)\s*=\s*)?"
    r"([A-Za-z][A-Za-z0-9_]*)\b",
    re.IGNORECASE,
)
DECLARATION_RE = re.compile(r"^\s*(function|classdef)\b", re.IGNORECASE)
FIGURE_RE = re.compile(r"^fig_(\d+)\.png$")

CAPTURE_SOURCE = f"""function {CAPTURE_FUNCTION}(imageDir)
cleanup = onCleanup(@() close('all', 'force')); %#ok<NASGU>
figures = flipud(findall(groot, 'Type', 'figure'));
figures = figures(:);
for figureIndex = 1:numel(figures)
    filePath = fullfile(imageDir, sprintf('fig_%d.png', figureIndex));
    try
        exportgraphics(figures(figureIndex), filePath, 'Resolution', 150);
    catch
        % Figure capture is best-effort; continue with the remaining figures.
    end
end
end
"""


_PROTOCOL_STDOUT: TextIO = sys.stdout
_EMIT_LOCK = threading.Lock()


def reserve_protocol_stdout() -> None:
    """Keep worker protocol output separate from library diagnostics."""
    global _PROTOCOL_STDOUT
    _PROTOCOL_STDOUT = sys.stdout
    sys.stdout = sys.stderr


def emit(message_type: str, **fields: Any) -> None:
    payload = {"type": message_type, **fields}
    line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with _EMIT_LOCK:
        _PROTOCOL_STDOUT.write(line + "\n")
        _PROTOCOL_STDOUT.flush()


def read_commands(commands: queue.Queue[dict[str, Any]]) -> None:
    for raw_line in sys.stdin:
        try:
            command = json.loads(raw_line)
            if not isinstance(command, dict):
                raise ValueError("command must be a JSON object")
            commands.put(command)
        except Exception as exc:
            commands.put({"type": "_invalid", "message": str(exc)})
    commands.put({"type": "shutdown"})


def atomic_write(path: Path, data: bytes) -> None:
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    try:
        temporary.write_bytes(data)
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def significant_lines(code: str) -> list[tuple[int, str]]:
    """Return non-comment MATLAB lines, excluding block comments."""
    result: list[tuple[int, str]] = []
    in_block_comment = False
    for index, raw_line in enumerate(code.lstrip("\ufeff").splitlines()):
        stripped = raw_line.lstrip()
        if in_block_comment:
            if stripped.startswith("%}"):
                in_block_comment = False
            continue
        if stripped.startswith("%{"):
            in_block_comment = True
            continue
        if not stripped or stripped.startswith("%"):
            continue
        result.append((index, raw_line))
    return result


def primary_function_name(code: str, declaration_line: int) -> str | None:
    """Parse a primary function name, including a continued declaration."""
    lines = code.lstrip("\ufeff").splitlines()
    header_parts: list[str] = []
    for raw_line in lines[declaration_line:]:
        continuation = raw_line.find("...")
        if continuation >= 0:
            header_parts.append(raw_line[:continuation])
            continue
        header_parts.append(raw_line)
        break
    match = FUNCTION_HEADER_RE.match(" ".join(header_parts))
    return match.group(1) if match else None


def classify_code(code: str) -> tuple[str, str | None]:
    lines = significant_lines(code)
    declarations: list[tuple[int, str]] = []
    for line_number, line in lines:
        match = DECLARATION_RE.match(line)
        if match:
            declarations.append((line_number, match.group(1).lower()))

    if any(kind == "classdef" for _, kind in declarations):
        return "unsupported_class", None
    if not declarations:
        return "eval", None

    first_line_number, first_line = lines[0]
    first_match = DECLARATION_RE.match(first_line)
    if first_match and first_match.group(1).lower() == "function":
        return "function", primary_function_name(code, first_line_number)
    return "script", None


@dataclass
class FunctionUpdate:
    name: str
    path: Path
    previous: bytes | None


@dataclass
class ActiveRun:
    run_id: Any
    image_dir: Path
    future: Any
    stdout: io.StringIO
    stderr: io.StringIO
    stdout_position: int = 0
    stderr_position: int = 0
    cancel_reason: str | None = None
    function_update: FunctionUpdate | None = None
    transient_script: Path | None = None


def flush_streams(active: ActiveRun) -> None:
    stdout = active.stdout.getvalue()
    if len(stdout) > active.stdout_position:
        emit(
            "stdout",
            id=active.run_id,
            data=stdout[active.stdout_position:],
        )
        active.stdout_position = len(stdout)

    stderr = active.stderr.getvalue()
    if len(stderr) > active.stderr_position:
        emit(
            "stderr",
            id=active.run_id,
            data=stderr[active.stderr_position:],
        )
        active.stderr_position = len(stderr)


def prepare_image_dir(session_dir: Path, run_id: Any, requested: Any) -> Path:
    if isinstance(requested, str) and requested:
        image_dir = Path(requested).resolve()
    else:
        safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", str(run_id))[:80] or "run"
        image_dir = session_dir / "images" / safe_id
    image_dir.mkdir(parents=True, exist_ok=True)
    for path in image_dir.glob("fig_*.png"):
        if FIGURE_RE.fullmatch(path.name):
            path.unlink()
    return image_dir


def write_capture_helper(session_dir: Path) -> None:
    atomic_write(
        session_dir / f"{CAPTURE_FUNCTION}.m",
        CAPTURE_SOURCE.encode("utf-8"),
    )


def restore_session_path(engine: Any, session_dir: Path) -> None:
    discard_stdout = io.StringIO()
    discard_stderr = io.StringIO()
    try:
        engine.rmpath(
            str(session_dir),
            nargout=0,
            stdout=discard_stdout,
            stderr=discard_stderr,
        )
    except Exception:
        pass
    engine.addpath(str(session_dir), "-begin", nargout=0)


def close_figures(engine: Any) -> None:
    try:
        engine.eval("close all force;", nargout=0)
    except Exception:
        pass


def capture_figures(
    engine: Any,
    image_dir: Path,
    run_id: Any,
) -> list[dict[str, Any]]:
    try:
        capture_stdout = io.StringIO()
        capture_stderr = io.StringIO()
        engine.feval(
            CAPTURE_FUNCTION,
            str(image_dir),
            nargout=0,
            stdout=capture_stdout,
            stderr=capture_stderr,
        )
    except Exception as exc:
        close_figures(engine)
        emit("stderr", id=run_id, data=f"Failed to capture MATLAB figures: {exc}\n")

    figures: list[tuple[int, Path]] = []
    try:
        for path in image_dir.iterdir():
            match = FIGURE_RE.fullmatch(path.name)
            if match and path.is_file():
                figures.append((int(match.group(1)), path.resolve()))
    except OSError as exc:
        emit("stderr", id=run_id, data=f"Failed to collect MATLAB figures: {exc}\n")

    figures.sort(key=lambda item: item[0])
    return [
        {"path": str(path), "figureIndex": figure_index}
        for figure_index, path in figures
    ]


def refresh_function(engine: Any, session_dir: Path, name: str) -> None:
    restore_session_path(engine, session_dir)
    engine.eval(f"clear {name}; rehash;", nargout=0)


def rollback_function(engine: Any, update: FunctionUpdate, run_id: Any) -> None:
    try:
        if update.previous is None:
            try:
                update.path.unlink()
            except FileNotFoundError:
                pass
        else:
            atomic_write(update.path, update.previous)
        refresh_function(engine, update.path.parent, update.name)
    except Exception as exc:
        emit(
            "stderr",
            id=run_id,
            data=f"Failed to restore the previous MATLAB function: {exc}\n",
        )


def immediate_failure(
    engine: Any,
    run_id: Any,
    image_dir: Path,
    message: str,
) -> None:
    emit("stderr", id=run_id, data=message.rstrip() + "\n")
    figures = capture_figures(engine, image_dir, run_id)
    emit(
        "done",
        id=run_id,
        exitCode=1,
        killed=False,
        cancelled=False,
        figures=figures,
    )


def start_run(
    engine: Any,
    session_dir: Path,
    command: dict[str, Any],
    script_counter: int,
) -> tuple[ActiveRun | None, int]:
    run_id = command.get("id")
    code = command.get("code")
    if run_id is None or not isinstance(code, str):
        emit("fatal", message="run requires an id and string code")
        return None, script_counter

    try:
        image_dir = prepare_image_dir(session_dir, run_id, command.get("imageDir"))
    except Exception as exc:
        emit("stderr", id=run_id, data=f"Failed to prepare figure output: {exc}\n")
        emit(
            "done",
            id=run_id,
            exitCode=1,
            killed=False,
            cancelled=False,
            figures=[],
        )
        return None, script_counter

    mode, function_name = classify_code(code)
    if mode == "unsupported_class":
        immediate_failure(
            engine,
            run_id,
            image_dir,
            "classdef fences are not supported.",
        )
        return None, script_counter
    if mode == "function" and not function_name:
        immediate_failure(
            engine,
            run_id,
            image_dir,
            "Could not determine the primary MATLAB function name.",
        )
        return None, script_counter
    if mode == "function" and function_name.casefold() == CAPTURE_FUNCTION.casefold():
        immediate_failure(
            engine,
            run_id,
            image_dir,
            f"{CAPTURE_FUNCTION} is reserved by Code Suite.",
        )
        return None, script_counter

    stdout = io.StringIO()
    stderr = io.StringIO()
    transient_script: Path | None = None
    function_update: FunctionUpdate | None = None

    try:
        if mode == "function":
            assert function_name is not None
            function_path = session_dir / f"{function_name}.m"
            previous = function_path.read_bytes() if function_path.exists() else None
            function_update = FunctionUpdate(function_name, function_path, previous)
            atomic_write(function_path, code.encode("utf-8"))
            eval_code = (
                f"clear {function_name}; rehash; "
                f"nargin('{function_name}');"
            )
        elif mode == "script":
            script_counter += 1
            script_name = (
                f"codesuite_script_{script_counter:x}_{secrets.token_hex(5)}"
            )
            transient_script = session_dir / f"{script_name}.m"
            atomic_write(transient_script, code.encode("utf-8"))
            eval_code = f"{script_name};"
        else:
            eval_code = code

        restore_session_path(engine, session_dir)
        future = engine.eval(
            eval_code,
            nargout=0,
            stdout=stdout,
            stderr=stderr,
            background=True,
        )
    except Exception as exc:
        if function_update is not None:
            rollback_function(engine, function_update, run_id)
        if transient_script is not None:
            try:
                transient_script.unlink()
            except FileNotFoundError:
                pass
        immediate_failure(engine, run_id, image_dir, str(exc))
        return None, script_counter

    return (
        ActiveRun(
            run_id=run_id,
            image_dir=image_dir,
            future=future,
            stdout=stdout,
            stderr=stderr,
            function_update=function_update,
            transient_script=transient_script,
        ),
        script_counter,
    )


def request_cancel(active: ActiveRun, reason: Any) -> None:
    if active.cancel_reason is not None:
        return
    active.cancel_reason = "timeout" if reason == "timeout" else "user"
    try:
        active.future.cancel()
    except Exception as exc:
        emit("stderr", id=active.run_id, data=f"Failed to interrupt MATLAB: {exc}\n")


def finish_run(engine: Any, active: ActiveRun) -> None:
    execution_error: Exception | None = None
    try:
        active.future.result()
    except Exception as exc:
        execution_error = exc

    flush_streams(active)
    emit("stdout", id=active.run_id, data="", executionDone=True)

    cancelled = active.cancel_reason in {"user", "shutdown"}
    killed = active.cancel_reason == "timeout"
    succeeded = execution_error is None and active.cancel_reason is None

    if active.transient_script is not None:
        try:
            active.transient_script.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            emit(
                "stderr",
                id=active.run_id,
                data=f"Failed to remove temporary MATLAB script: {exc}\n",
            )

    if active.function_update is not None and not succeeded:
        rollback_function(engine, active.function_update, active.run_id)

    if execution_error is not None and active.cancel_reason is None:
        message = str(execution_error).strip()
        captured_stderr = active.stderr.getvalue()
        if message and message not in captured_stderr:
            emit("stderr", id=active.run_id, data=message + "\n")

    if cancelled:
        close_figures(engine)
        figures: list[dict[str, Any]] = []
    else:
        figures = capture_figures(
            engine,
            active.image_dir,
            active.run_id,
        )

    if cancelled or killed:
        exit_code: int | None = None
    else:
        exit_code = 0 if execution_error is None else 1

    emit(
        "done",
        id=active.run_id,
        exitCode=exit_code,
        killed=killed,
        cancelled=cancelled,
        figures=figures,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--session-dir", required=True)
    parser.add_argument("--cwd", default="")
    return parser.parse_args()


def main() -> int:
    engine: Any | None = None
    try:
        reserve_protocol_stdout()
        args = parse_args()
        session_dir = Path(args.session_dir).resolve()
        session_dir.mkdir(parents=True, exist_ok=True)
        write_capture_helper(session_dir)

        commands: queue.Queue[dict[str, Any]] = queue.Queue()
        reader = threading.Thread(
            target=read_commands,
            args=(commands,),
            name="codesuite-matlab-stdin",
            daemon=True,
        )
        reader.start()

        import matlab.engine

        engine = matlab.engine.start_matlab()
        restore_session_path(engine, session_dir)
        if args.cwd:
            engine.cd(str(Path(args.cwd).resolve()), nargout=0)
        engine.eval("set(groot, 'defaultFigureVisible', 'off');", nargout=0)

        release = str(engine.version("-release"))
        emit("ready", release=release)

        active: ActiveRun | None = None
        script_counter = 0
        shutdown_requested = False

        while True:
            try:
                command = commands.get(timeout=POLL_SECONDS if active else None)
            except queue.Empty:
                command = None

            if command is not None:
                command_type = command.get("type")
                if command_type == "_invalid":
                    emit("fatal", message=f"Invalid worker command: {command.get('message', '')}")
                    shutdown_requested = True
                    if active is not None:
                        request_cancel(active, "user")
                elif command_type == "shutdown":
                    shutdown_requested = True
                    if active is not None:
                        request_cancel(active, "shutdown")
                elif command_type == "cancel":
                    if active is not None and command.get("id") == active.run_id:
                        request_cancel(active, command.get("reason"))
                elif command_type == "run":
                    if active is not None:
                        run_id = command.get("id")
                        emit("stderr", id=run_id, data="MATLAB session is already running code.\n")
                        emit(
                            "done",
                            id=run_id,
                            exitCode=1,
                            killed=False,
                            cancelled=False,
                            figures=[],
                        )
                    elif not shutdown_requested:
                        active, script_counter = start_run(
                            engine,
                            session_dir,
                            command,
                            script_counter,
                        )
                else:
                    emit("fatal", message=f"Unknown worker command: {command_type!r}")
                    shutdown_requested = True

            if active is not None:
                flush_streams(active)
                if active.future.done():
                    finish_run(engine, active)
                    active = None

            if shutdown_requested and active is None:
                break

        return 0
    except BaseException as exc:
        emit("fatal", message=str(exc) or exc.__class__.__name__)
        return 1
    finally:
        if engine is not None:
            try:
                engine.quit()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
