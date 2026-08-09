from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from typing import Any


WORKER_PATH = Path(__file__).parents[1] / "src" / "matlab-worker.py"
SPEC = importlib.util.spec_from_file_location("codesuite_matlab_worker", WORKER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load MATLAB worker from {WORKER_PATH}")
worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)


class FakeFuture:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error

    def result(self) -> None:
        if self.error is not None:
            raise self.error

    def done(self) -> bool:
        return True

    def cancel(self) -> bool:
        return True


class FakeEngine:
    def __init__(self, future: FakeFuture) -> None:
        self.future = future
        self.eval_calls: list[str] = []

    def eval(self, code: str, *args: Any, **kwargs: Any) -> FakeFuture | None:
        self.eval_calls.append(code)
        return self.future if kwargs.get("background") else None

    def rmpath(self, *args: Any, **kwargs: Any) -> None:
        pass

    def addpath(self, *args: Any, **kwargs: Any) -> None:
        pass

    def feval(self, *args: Any, **kwargs: Any) -> None:
        pass


class MatlabClassifierTests(unittest.TestCase):
    def test_classifies_supported_fence_shapes(self) -> None:
        cases = {
            "": ("eval", None),
            "% comment\nx = 1;": ("eval", None),
            "% comment\nfunction y = square(x)\ny = x.^2;\nend": ("function", "square"),
            "x = 1;\nfunction y = local_value()\ny = 2;\nend": ("script", None),
            "classdef Example\nend": ("unsupported_class", None),
            "%{\nclassdef Ignored\nfunction ignored\n%}\nx = 1;": ("eval", None),
        }
        for code, expected in cases.items():
            with self.subTest(code=code):
                self.assertEqual(worker.classify_code(code), expected)

    def test_parses_continued_primary_function_declaration(self) -> None:
        code = """function [value, ...
other] = ...
calculate(x)
value = x;
other = x;
end
"""
        self.assertEqual(worker.classify_code(code), ("function", "calculate"))


class MatlabWorkerCleanupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.messages: list[tuple[str, dict[str, Any]]] = []
        self.original_emit = worker.emit
        worker.emit = lambda message_type, **fields: self.messages.append((message_type, fields))

    def tearDown(self) -> None:
        worker.emit = self.original_emit

    def test_successful_script_run_removes_transient_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session_dir = Path(temp_dir)
            engine = FakeEngine(FakeFuture())
            active, counter = worker.start_run(
                engine,
                session_dir,
                {
                    "id": "script-run",
                    "code": "x = 1;\nfunction y = local_value()\ny = 2;\nend",
                },
                0,
            )

            self.assertEqual(counter, 1)
            self.assertIsNotNone(active)
            assert active is not None
            self.assertIsNotNone(active.transient_script)
            assert active.transient_script is not None
            self.assertTrue(active.transient_script.exists())

            worker.finish_run(engine, session_dir, active)

            self.assertFalse(active.transient_script.exists())
            self.assertEqual(self.messages[-1][0], "done")
            self.assertEqual(self.messages[-1][1]["exitCode"], 0)

    def test_reserved_capture_function_is_case_insensitive(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            active, counter = worker.start_run(
                FakeEngine(FakeFuture()),
                Path(temp_dir),
                {
                    "id": "reserved-function",
                    "code": "function Codesuite_Internal_Capture_7D9B21()\nend\n",
                },
                0,
            )

            self.assertIsNone(active)
            self.assertEqual(counter, 0)
            self.assertEqual(self.messages[-1][0], "done")
            self.assertEqual(self.messages[-1][1]["exitCode"], 1)

    def test_failed_function_update_restores_previous_definition(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session_dir = Path(temp_dir)
            function_path = session_dir / "value.m"
            previous = b"function y = value()\ny = 1;\nend\n"
            function_path.write_bytes(previous)
            engine = FakeEngine(FakeFuture(RuntimeError("syntax error")))
            active, _ = worker.start_run(
                engine,
                session_dir,
                {
                    "id": "function-run",
                    "code": "function y = value()\ny = ;\nend\n",
                },
                0,
            )

            self.assertIsNotNone(active)
            assert active is not None
            self.assertNotEqual(function_path.read_bytes(), previous)

            worker.finish_run(engine, session_dir, active)

            self.assertEqual(function_path.read_bytes(), previous)
            self.assertEqual(self.messages[-1][0], "done")
            self.assertEqual(self.messages[-1][1]["exitCode"], 1)


if __name__ == "__main__":
    unittest.main()
