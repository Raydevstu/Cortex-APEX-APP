#!/usr/bin/env python3
"""
CortexOS Step 3: Deterministic PreToolUse Semantic & AST Scope Guard.
Compatible with Claude Code, Cursor, Codex, and OpenCode PreToolUse hooks.

Exit Codes:
  0 -> ALLOW tool execution
  2 -> BLOCK tool execution and feed stderr violation back to the AI agent
"""
import ast
import json
import os
import pathlib
import sys
from typing import Any, Dict, List, Optional

WRITE_TOOLS = {"Write", "Edit", "MultiEdit", "write_file", "replace_in_file", "create_file"}


def load_json_file(path: pathlib.Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def normalize_rel_path(target_path: str, repo_root: pathlib.Path) -> str:
    p = pathlib.Path(target_path)
    if p.is_absolute():
        try:
            return p.resolve().relative_to(repo_root.resolve()).as_posix()
        except ValueError:
            return p.as_posix()
    return pathlib.PurePath(target_path).as_posix().removeprefix("./")


def extract_candidate_content(tool_input: Dict[str, Any]) -> str:
    for key in ("content", "new_str", "new_string", "replacement", "patch"):
        val = tool_input.get(key)
        if isinstance(val, str):
            return val
    edits = tool_input.get("edits")
    if isinstance(edits, list):
        return "\n".join(
            str(e.get("new_string") or e.get("content") or "")
            for e in edits
            if isinstance(e, dict)
        )
    return ""


def check_python_ast_constraints(content: str, max_func_lines: int) -> List[str]:
    violations: List[str] = []
    try:
        tree = ast.parse(content)
    except SyntaxError as exc:
        return [f"Python AST SyntaxError at line {exc.lineno}: {exc.msg}"]

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            end_lineno = getattr(node, "end_lineno", node.lineno)
            func_len = end_lineno - node.lineno + 1
            if func_len > max_func_lines:
                violations.append(
                    f"AST Function '{node.name}' is {func_len} lines "
                    f"(exceeds Project DNA maxFunctionLines={max_func_lines})."
                )
    return violations


def validate_tool_call(payload: Dict[str, Any], repo_root: pathlib.Path) -> List[str]:
    tool_name = str(payload.get("tool_name") or payload.get("tool") or "")
    if tool_name not in WRITE_TOOLS:
        return []

    tool_input = payload.get("tool_input") or payload.get("input") or {}
    raw_file_path = (
        tool_input.get("file_path")
        or tool_input.get("path")
        or tool_input.get("target_file")
    )
    if not raw_file_path:
        return []

    rel_path = normalize_rel_path(str(raw_file_path), repo_root)

    dna = load_json_file(repo_root / ".cortex" / "project-dna.json") or {}
    scope = load_json_file(repo_root / ".cortex" / "active-task-scope.json") or {}

    protected_paths = set(
        scope.get("protectedPaths")
        or dna.get("architecture", {}).get("protectedPaths", [])
    )
    allowed_write_files = scope.get("allowedWriteFiles") or []
    forbidden_patterns = (
        scope.get("forbiddenPatterns")
        or dna.get("architecture", {}).get("forbiddenPatterns", [])
    )
    max_func_lines = int(
        scope.get("maxFunctionLines")
        or dna.get("codingStandards", {}).get("maxFunctionLines", 60)
    )

    violations: List[str] = []

    if rel_path in protected_paths:
        violations.append(
            f"SCOPE VIOLATION: '{rel_path}' is a protected Project DNA file and cannot be modified."
        )

    if allowed_write_files and rel_path not in allowed_write_files:
        violations.append(
            f"OUT-OF-SCOPE WRITE: '{rel_path}' is not in activeTaskScope.allowedWriteFiles {allowed_write_files}."
        )

    candidate_content = extract_candidate_content(tool_input)
    if candidate_content:
        for pattern in forbidden_patterns:
            if pattern and pattern in candidate_content:
                violations.append(
                    f"FORBIDDEN PATTERN: Code contains banned pattern '{pattern}' per Project DNA."
                )

        if rel_path.endswith(".py") and tool_name in {"Write", "write_file", "create_file"}:
            violations.extend(check_python_ast_constraints(candidate_content, max_func_lines))

    return violations


def main() -> int:
    repo_root = pathlib.Path(os.environ.get("CORTEX_REPO_ROOT", os.getcwd()))
    raw_stdin = sys.stdin.read().strip()
    if not raw_stdin:
        return 0

    try:
        payload = json.loads(raw_stdin)
    except json.JSONDecodeError:
        return 0

    violations = validate_tool_call(payload, repo_root)
    if violations:
        error_report = {
            "decision": "block",
            "reason": "CortexOS PreToolUse AST & Scope Guard blocked this edit.",
            "violations": violations,
        }
        sys.stderr.write(json.dumps(error_report, indent=2) + "\n")
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
