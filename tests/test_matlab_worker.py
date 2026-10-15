"""MATLAB worker tests; opt into Engine tests with CODE_SUITE_TEST_MATLAB=1."""

from __future__ import annotations

import importlib.util
import os
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
    def __init__(self, future: FakeFuture, *, script_file: bool = False) -> None:
        self.future = future
        self.script_file = script_file
        self.eval_calls: list[str] = []
        self.feval_calls: list[str] = []

    def eval(self, code: str, *args: Any, **kwargs: Any) -> FakeFuture | None:
        self.eval_calls.append(code)
        return self.future if kwargs.get("background") else None

    def rmpath(self, *args: Any, **kwargs: Any) -> None:
        pass

    def addpath(self, *args: Any, **kwargs: Any) -> None:
        pass

    def feval(self, name: str, *args: Any, **kwargs: Any) -> bool | None:
        self.feval_calls.append(name)
        if name == worker.IS_SCRIPT_FUNCTION:
            return self.script_file
        return None


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

            worker.finish_run(engine, active)

            self.assertFalse(active.transient_script.exists())
            self.assertEqual(self.messages[-1][0], "done")
            self.assertEqual(self.messages[-1][1]["exitCode"], 0)

    def test_function_first_script_does_not_replace_a_registered_function(self) -> None:
        code = "function y = test_fun(x)\ny = x + 1;\nend\n\n% Call the function\na = test_fun(5);\ndisp(a);"
        with tempfile.TemporaryDirectory() as temp_dir:
            session_dir = Path(temp_dir)
            registered = session_dir / "test_fun.m"
            previous = b"function y = test_fun(x)\ny = x + 10;\nend\n"
            registered.write_bytes(previous)
            engine = FakeEngine(FakeFuture(), script_file=True)
            active, counter = worker.start_run(
                engine, session_dir, {"id": "mixed-run", "code": code}, 0,
            )

            self.assertIsNotNone(active)
            assert active is not None
            self.assertIsNone(active.function_update)
            self.assertEqual(counter, 1)
            script = active.transient_script
            self.assertIsNotNone(script)
            assert script is not None
            self.assertNotEqual(script.stem, "test_fun")
            self.assertEqual(script.read_text(encoding="utf-8"), code)
            self.assertEqual(engine.eval_calls[-1], f"{script.stem};")
            self.assertEqual(registered.read_bytes(), previous)
            self.assertEqual(list(session_dir.glob("codesuite_probe_*.m")), [])

            worker.finish_run(engine, active)

            self.assertFalse(script.exists())
            self.assertEqual(registered.read_bytes(), previous)
            self.assertEqual(self.messages[-1][1]["exitCode"], 0)

    def test_pure_function_with_required_input_is_registered_without_calling_it(self) -> None:
        code = "function y = test_fun(x)\nerror('body must not execute');\ny = x + 1;\nend\n"
        with tempfile.TemporaryDirectory() as temp_dir:
            session_dir = Path(temp_dir)
            engine = FakeEngine(FakeFuture())
            active, counter = worker.start_run(
                engine, session_dir, {"id": "definition", "code": code}, 0,
            )

            self.assertIsNotNone(active)
            assert active is not None
            self.assertIsNotNone(active.function_update)
            self.assertIsNone(active.transient_script)
            self.assertEqual(counter, 0)
            self.assertEqual(engine.eval_calls[-1], "clear test_fun; rehash; nargin('test_fun');")
            self.assertEqual(list(session_dir.glob("codesuite_probe_*.m")), [])

            worker.finish_run(engine, active)

            self.assertEqual((session_dir / "test_fun.m").read_text(encoding="utf-8"), code)
            self.assertEqual(self.messages[-1][1]["exitCode"], 0)

    def test_failed_native_probe_is_cleaned_up_before_reporting_failure(self) -> None:
        class FailedProbeEngine(FakeEngine):
            def feval(self, name: str, *args: Any, **kwargs: Any) -> bool | None:
                if name == worker.IS_SCRIPT_FUNCTION:
                    raise RuntimeError("probe failed")
                return super().feval(name, *args, **kwargs)

        with tempfile.TemporaryDirectory() as temp_dir:
            session_dir = Path(temp_dir)
            registered = session_dir / "test_fun.m"
            previous = b"function y = test_fun(x)\ny = x;\nend\n"
            registered.write_bytes(previous)
            active, _ = worker.start_run(
                FailedProbeEngine(FakeFuture()), session_dir,
                {"id": "failed-probe", "code": "function y = test_fun(x)\ny = x + 1;\nend"}, 0,
            )

            self.assertIsNone(active)
            self.assertEqual(list(session_dir.glob("codesuite_probe_*.m")), [])
            self.assertEqual(registered.read_bytes(), previous)
            self.assertEqual(self.messages[-1][1]["exitCode"], 1)

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

    def test_script_classifier_function_name_is_reserved(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            active, _ = worker.start_run(
                FakeEngine(FakeFuture()), Path(temp_dir),
                {"id": "reserved-classifier", "code": f"function {worker.IS_SCRIPT_FUNCTION.upper()}()\nend\n"}, 0,
            )
            self.assertIsNone(active)
            self.assertEqual(self.messages[-1][1]["exitCode"], 1)

    def test_figure_capture_reuses_the_installed_helper(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            engine = FakeEngine(FakeFuture())
            figures = worker.capture_figures(engine, Path(temp_dir), "capture-run")

            self.assertEqual(figures, [])
            self.assertEqual(engine.feval_calls, [worker.CAPTURE_FUNCTION])
            self.assertEqual(engine.eval_calls, [])

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

            worker.finish_run(engine, active)

            self.assertEqual(function_path.read_bytes(), previous)
            self.assertEqual(self.messages[-1][0], "done")
            self.assertEqual(self.messages[-1][1]["exitCode"], 1)



@unittest.skipUnless(os.environ.get("CODE_SUITE_TEST_MATLAB") == "1", "requires a local MATLAB Engine")
class MatlabWorkerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import matlab.engine

        cls.engine = matlab.engine.start_matlab()
        cls.original_cwd = cls.engine.pwd()
        cls.original_path = cls.engine.path()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.engine.quit()

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="codesuite-integration-")
        self.session_dir = Path(self.directory.name)
        worker.write_helpers(self.session_dir)
        self.engine.cd(str(self.session_dir), nargout=0)
        self.messages = []
        self.original_emit = worker.emit
        worker.emit = lambda kind, **fields: self.messages.append((kind, fields))
        self.counter = 0

    def tearDown(self) -> None:
        worker.emit = self.original_emit
        self.engine.eval("clear; clear functions; close all force;", nargout=0)
        self.engine.cd(self.original_cwd, nargout=0)
        self.engine.path(self.original_path, nargout=0)
        self.directory.cleanup()

    def run_code(self, code: str, expected_exit: int = 0):
        self.messages.clear()
        active, self.counter = worker.start_run(
            self.engine, self.session_dir,
            {"id": "integration", "code": code}, self.counter,
        )
        if active is not None:
            worker.finish_run(self.engine, active)
        self.assertEqual(self.messages[-1][0], "done", self.messages)
        self.assertEqual(self.messages[-1][1]["exitCode"], expected_exit, self.messages)
        self.assertEqual(list(self.session_dir.glob("codesuite_probe_*.m")), [])
        self.assertEqual(list(self.session_dir.glob("codesuite_script_*.m")), [])
        return active

    def test_screenshot_script_runs_once_without_replacing_a_registered_function(self) -> None:
        if self.engine.isMATLABReleaseOlderThan("R2024a"):
            self.skipTest("function-first scripts require MATLAB R2024a or later")
        self.run_code("function y = test_fun(x)\ny = x + 10;\nend")
        registered = self.session_dir / "test_fun.m"
        previous = registered.read_bytes()
        self.engine.eval("run_count = 0;", nargout=0)

        active = self.run_code(
            "function y = test_fun(x)\ny = x + 1;\nend\n\n"
            "% Call the function\na = test_fun(5);\ndisp(a);\nrun_count = run_count + 1;"
        )

        self.assertIsNotNone(active.transient_script)
        self.assertIsNone(active.function_update)
        self.assertEqual(self.engine.workspace["a"], 6)
        self.assertEqual(self.engine.workspace["run_count"], 1)
        self.assertEqual(registered.read_bytes(), previous)
        self.assertEqual(self.engine.feval("test_fun", 5.0), 15)

    def test_required_arguments_are_only_needed_when_the_function_is_called(self) -> None:
        active = self.run_code(
            "function y = test_fun(x)\n"
            "if nargin == 0, error('test:called', 'body was called'); end\n"
            "y = x + 1;\nend"
        )
        self.assertIsNotNone(active.function_update)
        self.assertIsNone(active.transient_script)
        self.run_code("a = test_fun(5); disp(a);")
        self.assertEqual(self.engine.workspace["a"], 6)

    def test_native_parser_handles_function_syntax_without_counting_end_keywords(self) -> None:
        cases = [
            ("implicit", "function y = implicit(x)\ny = x + 1;", 5.0),
            ("structured", """function y = structured(x)
arguments
    x (1,1) double
end
text = "end function";
values = [x x + 1];
if strlength(text) > 0
    y = nested(values(end)');
end
    function z = nested(v)
        z = v;
    end
end
""", 5.0),
            ("continued", """function [y, ...
z] = ...
continued(x)
y = helper(x);
z = x;
end
function y = helper(x)
y = x + 1;
end
""", 5.0),
        ]
        for name, code, argument in cases:
            with self.subTest(name=name):
                active = self.run_code(code)
                self.assertIsNotNone(active.function_update)
                self.assertEqual(self.engine.feval(name, argument), 6)

    def test_syntax_error_still_restores_the_previous_function(self) -> None:
        self.run_code("function y = test_fun(x)\ny = x + 1;\nend")
        self.run_code("function y = test_fun(x)\ny = ;\nend", expected_exit=1)
        self.assertEqual(self.engine.feval("test_fun", 5.0), 6)


if __name__ == "__main__":
    unittest.main()
