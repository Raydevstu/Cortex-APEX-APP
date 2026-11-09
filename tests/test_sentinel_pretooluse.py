import json
import tempfile
import unittest
from pathlib import Path
from hooks.sentinel_pretooluse import evaluate_payload


class TestSentinelPreToolUse(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        cortex_dir = self.root / ".cortex"
        cortex_dir.mkdir(parents=True, exist_ok=True)

        dna = {
            "architectureRules": {"forbiddenPatterns": ["next-auth", "@ts-ignore", "axios"]},
            "codingStandards": {
                "astScopeGuardRules": {
                    "disallowAnyType": True,
                    "maxFunctionLines": 10,
                    "protectedPaths": ["prisma/migrations/", "src/lib/auth/tenant-guard.ts"],
                }
            },
        }
        (cortex_dir / "project-dna.json").write_text(json.dumps(dna), encoding="utf-8")

        scope_lock = {
            "allowedWriteFiles": ["src/app/(auth)/sign-in/*", "src/features/auth/*", "scripts/helper.py"],
            "forbiddenPatterns": [],
        }
        (cortex_dir / "active-scope-lock.json").write_text(json.dumps(scope_lock), encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_allows_valid_in_scope_write(self):
        payload = {"tool_name": "Write", "tool_input": {"file_path": "src/features/auth/login-card.tsx", "content": "export function LoginCard({ orgId }: { orgId: string }) { return <div />; }"}}
        code, msg = evaluate_payload(payload, self.root)
        self.assertEqual(code, 0)
        self.assertEqual(msg, "ALLOW")

    def test_blocks_protected_path(self):
        payload = {"tool_name": "Edit", "tool_input": {"file_path": "src/lib/auth/tenant-guard.ts", "new_string": "export const bypass = true;"}}
        code, msg = evaluate_payload(payload, self.root)
        self.assertEqual(code, 2)
        self.assertIn("protectedPaths", msg)

    def test_blocks_out_of_scope_file(self):
        payload = {"tool_name": "Write", "tool_input": {"file_path": "src/features/billing/stripe.ts", "content": "export const stripe = {};"}}
        code, msg = evaluate_payload(payload, self.root)
        self.assertEqual(code, 2)
        self.assertIn("Out-of-scope file mutation", msg)

    def test_blocks_forbidden_pattern_and_any_type(self):
        payload = {"tool_name": "Write", "tool_input": {"file_path": "src/features/auth/session.ts", "content": "import NextAuth from 'next-auth'; export const data: any = {};"}}
        code, msg = evaluate_payload(payload, self.root)
        self.assertEqual(code, 2)
        self.assertIn("forbidden Project DNA pattern", msg)

    def test_blocks_python_function_exceeding_max_ast_lines(self):
        long_fn = "def too_long():\n" + "\n".join(f"    x_{i} = {i}" for i in range(15))
        payload = {"tool_name": "Write", "tool_input": {"file_path": "scripts/helper.py", "content": long_fn}}
        code, msg = evaluate_payload(payload, self.root)
        self.assertEqual(code, 2)
        self.assertIn("exceeding maxFunctionLines=10", msg)

    def test_allows_when_no_cortex_dir(self):
        # Fail-open: no .cortex files => no rules => ALLOW
        empty = Path(tempfile.mkdtemp())
        payload = {"tool_name": "Write", "tool_input": {"file_path": "src/foo.ts", "content": "export const x = 1;"}}
        code, msg = evaluate_payload(payload, empty)
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
