import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT_PATH = pathlib.Path(__file__).resolve().parent.parent / "hooks" / "sentinel_pretooluse.py"


class TestSentinelPreToolUse(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = pathlib.Path(self.temp_dir.name)
        cortex_dir = self.repo_root / ".cortex"
        cortex_dir.mkdir(parents=True, exist_ok=True)

        scope_lock = {
            "activeTaskId": "task_auth_01",
            "taskTitle": "Refactor JWT verifier",
            "allowedWriteFiles": ["src/auth/jwt_verifier.py", "src/auth/types.ts"],
            "protectedPaths": [".cortex/project-dna.json", ".env"],
            "forbiddenPatterns": ["eval(", "child_process.exec("],
            "maxFunctionLines": 15,
        }
        (cortex_dir / "active-task-scope.json").write_text(
            json.dumps(scope_lock), encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_hook(self, payload: dict) -> subprocess.CompletedProcess:
        env = os.environ.copy()
        env["CORTEX_REPO_ROOT"] = str(self.repo_root)
        return subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )

    def test_allows_in_scope_clean_write(self) -> None:
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": "src/auth/jwt_verifier.py",
                "content": "def verify_token(token: str) -> bool:\n    return bool(token)\n",
            },
        }
        res = self.run_hook(payload)
        self.assertEqual(res.returncode, 0, f"Expected 0, got stderr: {res.stderr}")

    def test_blocks_protected_path_modification(self) -> None:
        payload = {
            "tool_name": "Edit",
            "tool_input": {
                "file_path": ".cortex/project-dna.json",
                "new_str": "{}",
            },
        }
        res = self.run_hook(payload)
        self.assertEqual(res.returncode, 2)
        self.assertIn("SCOPE VIOLATION", res.stderr)

    def test_blocks_out_of_scope_file_write(self) -> None:
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": "src/billing/stripe.ts",
                "content": "export const charge = () => {};",
            },
        }
        res = self.run_hook(payload)
        self.assertEqual(res.returncode, 2)
        self.assertIn("OUT-OF-SCOPE WRITE", res.stderr)

    def test_blocks_forbidden_pattern_eval(self) -> None:
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": "src/auth/jwt_verifier.py",
                "content": "def bad(x):\n    return eval(x)\n",
            },
        }
        res = self.run_hook(payload)
        self.assertEqual(res.returncode, 2)
        self.assertIn("FORBIDDEN PATTERN", res.stderr)

    def test_blocks_ast_function_exceeding_max_lines(self) -> None:
        long_body = "\n".join([f"    x_{i} = {i}" for i in range(20)])
        content = f"def overly_long_function():\n{long_body}\n    return x_0\n"
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": "src/auth/jwt_verifier.py",
                "content": content,
            },
        }
        res = self.run_hook(payload)
        self.assertEqual(res.returncode, 2)
        self.assertIn("exceeds Project DNA maxFunctionLines=15", res.stderr)


if __name__ == "__main__":
    unittest.main()
