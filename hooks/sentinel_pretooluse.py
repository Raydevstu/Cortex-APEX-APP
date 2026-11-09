#!/usr/bin/env python3
"""
CortexOS AST Semantic Scope Guard & PreToolUse Sentinel Boundary
Location: hooks/sentinel_pretooluse.py

Protocol:
- Reads PreToolUse JSON payload from stdin (Claude Code / Cursor / Codex / Hermes hook standard).
- Exit Code 0: ALLOW tool execution.
- Exit Code 2: BLOCK tool execution and return deterministic violation reason on stderr.

Reads (best-effort, never hard-fails if absent):
  <project>/.cortex/project-dna.json       — immutable rules + protected paths
  <project>/.cortex/active-scope-lock.json — current task's allowed write files
"""
import ast
import fnmatch
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

WRITE_TOOL_NAMES = {
    "Write", "Edit", "MultiEdit", "Replace", "CreateFile", "Patch",
    "write_file", "edit_file", "apply_diff", "str_replace_editor",
}
BASH_TOOL_NAMES = {"Bash", "RunCommand", "execute_command", "bash"}


def load_json_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def normalize_rel_path(target_path: str, project_root: Path) -> str:
    try:
        resolved = (project_root / target_path).resolve()
        return str(resolved.relative_to(project_root.resolve())).replace("\\", "/")
    except ValueError:
        return f"OUTSIDE_ROOT::{target_path}"


def extract_target_file_and_content(tool_name: str, tool_input: Dict[str, Any]) -> Tuple[Optional[str], str]:
    file_path = (
        tool_input.get("file_path")
        or tool_input.get("path")
        or tool_input.get("target_file")
        or tool_input.get("filename")
    )
    content_fragments: List[str] = []
    for key in ("content", "new_string", "new_str", "replacement", "diff", "patch"):
        val = tool_input.get(key)
        if isinstance(val, str):
            content_fragments.append(val)
    edits = tool_input.get("edits")
    if isinstance(edits, list):
        for edit in edits:
            if isinstance(edit, dict):
                ns = edit.get("new_string") or edit.get("content")
                if isinstance(ns, str):
                    content_fragments.append(ns)
    return file_path, "\n".join(content_fragments)


def check_ast_and_semantic_rules(rel_path: str, proposed_content: str, dna: Dict[str, Any], scope_lock: Dict[str, Any]) -> Optional[str]:
    if rel_path.startswith("OUTSIDE_ROOT::"):
        return f"[CORTEX SCOPE GUARD BLOCK] Target path '{rel_path}' escapes project root."

    coding_standards = dna.get("codingStandards", {})
    ast_rules = coding_standards.get("astScopeGuardRules", {}) if isinstance(coding_standards, dict) else {}
    protected_paths: List[str] = (ast_rules.get("protectedPaths") if isinstance(ast_rules, dict) else None) or []

    # 1. Protected Path Check
    for protected in protected_paths:
        norm_prot = protected.rstrip("/")
        if rel_path == norm_prot or rel_path.startswith(norm_prot + "/") or fnmatch.fnmatch(rel_path, protected):
            return f"[CORTEX SCOPE GUARD BLOCK] File '{rel_path}' is locked by PROJECT_DNA.protectedPaths ('{protected}'). Do not modify this file."

    # 2. Active Scope Lock Check
    allowed_files: List[str] = scope_lock.get("allowedWriteFiles", []) or []
    if allowed_files:
        matched = any(rel_path == af.rstrip("/") or fnmatch.fnmatch(rel_path, af) for af in allowed_files)
        if not matched:
            return f"[CORTEX SCOPE GUARD BLOCK] Out-of-scope file mutation on '{rel_path}'. Active task scope lock only permits writes to: {allowed_files}"

    if not proposed_content.strip():
        return None

    # 3. Forbidden Patterns Check (DNA + Scope Lock)
    forbidden_patterns: List[str] = list(set(
        (dna.get("architectureRules", {}) or {}).get("forbiddenPatterns", []) or []
        + (scope_lock.get("forbiddenPatterns", []) or [])
    ))
    for pattern in forbidden_patterns:
        token = pattern.split("(")[0].strip().strip("'\"")
        if token and len(token) >= 3 and token in proposed_content:
            return f"[CORTEX SCOPE GUARD BLOCK] Proposed edit in '{rel_path}' contains forbidden Project DNA pattern: '{pattern}'."

    # 4. Disallow explicit `any` or `@ts-ignore` in TypeScript if configured
    disallow_any = ast_rules.get("disallowAnyType", False) if isinstance(ast_rules, dict) else False
    if disallow_any and rel_path.endswith((".ts", ".tsx")):
        if re.search(r":\s*any\b|<any>|as\s+any\b|@ts-ignore", proposed_content):
            return f"[CORTEX SCOPE GUARD BLOCK] Proposed TypeScript edit in '{rel_path}' violates `disallowAnyType: true` (found explicit `any` or `@ts-ignore`)."

    # 5. Python AST verification
    max_lines = ast_rules.get("maxFunctionLines", 0) if isinstance(ast_rules, dict) else 0
    if rel_path.endswith(".py"):
        try:
            tree = ast.parse(proposed_content)
            if max_lines and max_lines > 0:
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        end_lineno = getattr(node, "end_lineno", node.lineno)
                        fn_len = end_lineno - node.lineno + 1
                        if fn_len > max_lines:
                            return f"[CORTEX SCOPE GUARD BLOCK] Function '{node.name}' in '{rel_path}' is {fn_len} lines, exceeding maxFunctionLines={max_lines}."
        except SyntaxError as syn_err:
            if "def " in proposed_content and "import " in proposed_content:
                return f"[CORTEX SCOPE GUARD BLOCK] Invalid Python AST in '{rel_path}': {syn_err}"

    return None


def check_bash_command(command: str, dna: Dict[str, Any]) -> Optional[str]:
    dangerous_patterns = [r"rm\s+-rf\s+/", r"git\s+reset\s+--hard", r"git\s+push\s+--force", r"DROP\s+TABLE"]
    for pat in dangerous_patterns:
        if re.search(pat, command, re.IGNORECASE):
            return f"[CORTEX SCOPE GUARD BLOCK] Destructive bash command blocked: matches '{pat}'."
    protected_paths = []
    cs = dna.get("codingStandards", {})
    if isinstance(cs, dict):
        asr = cs.get("astScopeGuardRules", {})
        if isinstance(asr, dict):
            protected_paths = asr.get("protectedPaths", []) or []
    for prot in protected_paths:
        norm_prot = prot.rstrip("/")
        if norm_prot and norm_prot in command and any(op in command for op in (">", "rm ", "mv ", "sed -i", "tee ")):
            return f"[CORTEX SCOPE GUARD BLOCK] Bash command attempts to mutate protected path '{prot}'."
    return None


def evaluate_payload(payload: Dict[str, Any], project_root: Path) -> Tuple[int, str]:
    tool_name = payload.get("tool_name") or payload.get("tool") or ""
    tool_input = payload.get("tool_input") or payload.get("input") or {}

    cortex_dir = project_root / ".cortex"
    dna = load_json_file(cortex_dir / "project-dna.json")
    scope_lock = load_json_file(cortex_dir / "active-scope-lock.json")

    if tool_name in WRITE_TOOL_NAMES:
        target_file, content = extract_target_file_and_content(tool_name, tool_input)
        if not target_file:
            return 0, "ALLOW"
        rel_path = normalize_rel_path(target_file, project_root)
        violation = check_ast_and_semantic_rules(rel_path, content, dna, scope_lock)
        if violation:
            return 2, violation
    elif tool_name in BASH_TOOL_NAMES:
        cmd = tool_input.get("command") or tool_input.get("cmd") or ""
        if isinstance(cmd, str) and cmd.strip():
            violation = check_bash_command(cmd, dna)
            if violation:
                return 2, violation
    return 0, "ALLOW"


def main() -> None:
    project_root = Path(os.environ.get("CORTEX_PROJECT_ROOT", os.getcwd()))
    raw_stdin = sys.stdin.read().strip()
    if not raw_stdin:
        sys.exit(0)
    try:
        payload = json.loads(raw_stdin)
    except json.JSONDecodeError:
        sys.exit(0)
    exit_code, message = evaluate_payload(payload, project_root)
    if exit_code == 2:
        sys.stderr.write(message + "\n")
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
