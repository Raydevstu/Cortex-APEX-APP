#!/usr/bin/env python3
"""
CortexOS — Phase 4 End-to-End TDD Verification Suite (blueprint PHASE_4 §2
`tests/test_phase4_command_center.py`).

Verifies the Visual Command Center & AI CTO Mode against the LIVE daemon
(default http://localhost:4300 — the Phase 4 Command Center port; override
with the CORTEX_URL environment variable):

  1. GET /api/cortex/state — full CortexDashboardStateResponse contract
     (graph DTO, telemetry accounting, timeline, CTO recommendations,
     <cortex_sync_packet> XML parsed with a real XML parser)
  2. POST TOGGLE_SYMBOL_SCOPE — live AST scope-lock round-trip, persistence
     and timeline audit trail
  3. GET/POST /api/cortex/cto — audit contract + full DAG lifecycle
     (BUILD_DAG_PLAN → DISPATCH_PLAN → UPDATE_SUBTASK → ARCHIVE_PLAN)
  4. Validation envelopes (422 / 404)

Run:
    python3 -m unittest discover -s tests -p "test_*.py" -v
"""

from __future__ import annotations

import json
import os
import unittest
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

BASE_URL = os.environ.get("CORTEX_URL", "http://localhost:4300").rstrip("/")
API = f"{BASE_URL}/api/cortex"


def _request(method: str, path: str, body: dict | None = None) -> tuple[int, dict | None, str]:
    """Returns (status, parsed_json_or_None, raw_text)."""
    url = f"{API}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode("utf-8")
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        status = error.code
    try:
        return status, json.loads(raw), raw
    except json.JSONDecodeError:
        return status, None, raw


class Phase4CommandCenterTestCase(unittest.TestCase):
    """Shared fixtures: the default (most recently active) project."""

    @classmethod
    def setUpClass(cls):
        status, health, _ = _request("GET", "/health")
        if status != 200:
            raise unittest.SkipTest(
                f"Daemon not reachable at {BASE_URL} — start it with `npm run dev:cc` (port 4300) or `npm run dev` (port 3000) and set CORTEX_URL."
            )
        cls.project_id = None
        status, state, _ = _request("GET", "/state")
        if status == 200 and state:
            cls.project_id = None  # resolved implicitly by the daemon
            cls.state = state
        cls.base_state = state if status == 200 else None

    # ------------------------------------------------------------------
    # 1. State contract
    # ------------------------------------------------------------------

    def test_01_state_contract_graph(self):
        status, state, _ = _request("GET", "/state")
        self.assertEqual(status, 200)
        self.assertIn("graph", state)
        self.assertGreater(len(state["graph"]["nodes"]), 0)
        valid_labels = {
            "Module", "SourceFile", "ASTSymbol", "ArchitecturalDecision",
            "Task", "Bug", "SessionTurn", "Tech", "Feature", "External", "Root",
        }
        for node in state["graph"]["nodes"]:
            self.assertIn(node["label"], valid_labels, f"invalid node label {node['label']}")
            self.assertIn(node["scopeStatus"], ("IN_SCOPE", "LOCKED", "NEUTRAL"))
        node_ids = {node["id"] for node in state["graph"]["nodes"]}
        for edge in state["graph"]["edges"]:
            self.assertIn(edge["source"], node_ids, "edge references missing source")
            self.assertIn(edge["target"], node_ids, "edge references missing target")

    def test_02_state_contract_telemetry_accounting(self):
        status, state, _ = _request("GET", "/state")
        self.assertEqual(status, 200)
        telemetry = state["telemetry"]
        total = telemetry["localOllamaOffloadCount"] + telemetry["cloudEscalationCount"]
        self.assertEqual(total, telemetry["totalPromptsIntercepted"])
        self.assertGreaterEqual(telemetry["rawContextTokensEstimated"], telemetry["injectedSyncPacketTokens"])
        self.assertGreaterEqual(telemetry["netTokensSaved"], 0)
        self.assertGreaterEqual(telemetry["localOffloadPct"], 0)
        self.assertLessEqual(telemetry["localOffloadPct"], 100)

    def test_03_state_contract_timeline(self):
        status, state, _ = _request("GET", "/state")
        self.assertEqual(status, 200)
        self.assertIsInstance(state["timeline"], list)
        for event in state["timeline"]:
            self.assertTrue(event["turnId"])
            self.assertTrue(event["platform"])
            self.assertTrue(event["summary"])
            self.assertIsInstance(event["symbolsTouched"], list)
            self.assertIsInstance(event["decisionsRatified"], list)

    def test_04_state_contract_sync_packet_xml(self):
        status, state, _ = _request("GET", "/state")
        self.assertEqual(status, 200)
        xml_text = state["syncPacketXml"]
        root = ET.fromstring(xml_text)  # real parser — must be well-formed
        self.assertEqual(root.tag, "cortex_sync_packet")
        self.assertEqual(root.get("version"), "1.0.0")
        self.assertIsNotNone(root.find("active_task"))
        self.assertIsNotNone(root.find("active_task/allowed_symbols"))
        self.assertIsNotNone(root.find("active_task/forbidden_paths"))
        self.assertIsNotNone(root.find("dna_snapshot"))
        self.assertIsNotNone(root.find("continuity_state"))

    def test_05_state_contract_cto_recommendations(self):
        status, state, _ = _request("GET", "/state")
        self.assertEqual(status, 200)
        recommendations = state["ctoRecommendations"]
        self.assertGreaterEqual(len(recommendations), 1)
        categories = {
            "ARCHITECTURE_DRIFT", "SCOPE_LOCK_HAZARD", "TOKEN_OPTIMIZATION",
            "COMPLEXITY_HOTSPOT", "UNLINKED_REQUIREMENT",
        }
        actions = {"LOCK_SYMBOLS", "DECOMPOSE_DAG", "REFACTOR_LOCAL", "RATIFY_ADR"}
        for recommendation in recommendations:
            self.assertIn(recommendation["category"], categories)
            self.assertIn(recommendation["suggestedAction"]["actionType"], actions)
            self.assertTrue(recommendation["suggestedAction"]["commandPreview"])

    # ------------------------------------------------------------------
    # 2. AST scope locks
    # ------------------------------------------------------------------

    def test_10_toggle_symbol_scope_roundtrip(self):
        status, state, _ = _request("GET", "/state")
        self.assertEqual(status, 200)
        project_id = self._project_id(state)

        probe = "tests/phase4-probe.ts#probeSymbol"
        # Toggle 1 — unlock into the active write scope.
        status, toggled, _ = _request("POST", "/state", {
            "projectId": project_id, "action": "TOGGLE_SYMBOL_SCOPE", "fqn": probe,
        })
        self.assertEqual(status, 200)
        self.assertIn(probe, toggled["scopeLock"]["allowedSymbolFqns"])

        # Toggle 2 — lock it (sentinel-enforced).
        status, toggled, _ = _request("POST", "/state", {
            "projectId": project_id, "action": "TOGGLE_SYMBOL_SCOPE", "fqn": probe,
        })
        self.assertEqual(status, 200)
        self.assertIn(probe, toggled["scopeLock"]["lockedSymbolFqns"])
        self.assertNotIn(probe, toggled["scopeLock"]["allowedSymbolFqns"])

        # Persistence across a fresh GET.
        status, fresh, _ = _request("GET", "/state")
        self.assertEqual(status, 200)
        self.assertIn(probe, fresh["scopeLock"]["lockedSymbolFqns"])

        # Timeline audit trail.
        status, timeline, _ = _request("GET", f"/projects/{project_id}/timeline")
        self.assertEqual(status, 200)
        scope_events = [e for e in timeline["events"] if str(e["kind"]).startswith("scope.")]
        self.assertGreaterEqual(len(scope_events), 2)

        # Cleanup: restore the lock state.
        status, restored, _ = _request("POST", "/state", {
            "projectId": project_id, "action": "TOGGLE_SYMBOL_SCOPE", "fqn": probe,
        })
        self.assertEqual(status, 200)
        self.assertIn(probe, restored["scopeLock"]["allowedSymbolFqns"])
        status, _, _ = _request("POST", "/state", {
            "projectId": project_id, "action": "SET_SCOPE_LOCK",
            "allowedSymbolFqns": [f for f in restored["scopeLock"]["allowedSymbolFqns"] if f != probe],
        })
        self.assertEqual(status, 200)

    # ------------------------------------------------------------------
    # 3. AI CTO audit + DAG lifecycle
    # ------------------------------------------------------------------

    def test_20_cto_audit_contract(self):
        status, payload, _ = _request("GET", "/cto")
        self.assertEqual(status, 200)
        audit = payload["audit"]
        self.assertIn("recommendations", audit)
        self.assertIn("stats", audit)
        self.assertGreaterEqual(len(audit["recommendations"]), 1)
        self.assertIsInstance(payload["plans"], list)

    def test_21_dag_plan_lifecycle(self):
        status, state, _ = _request("GET", "/state")
        self.assertEqual(status, 200)
        project_id = self._project_id(state)

        # BUILD
        status, built, _ = _request("POST", "/cto", {
            "action": "BUILD_DAG_PLAN",
            "projectId": project_id,
            "goal": "phase 4 tdd probe — add an audit log endpoint with validation",
        })
        self.assertEqual(status, 200)
        plan = built["plan"]
        self.assertEqual(plan["status"], "draft")
        self.assertEqual(len(plan["subtasks"]), 4)
        self.assertGreaterEqual(len(plan["waves"]), 2)
        wave_one = plan["waves"][0]
        self.assertEqual(wave_one, ["subtask-1-contract-validation"])

        plan_id = plan["id"]

        # DISPATCH
        status, dispatched, _ = _request("POST", "/cto", {"action": "DISPATCH_PLAN", "planId": plan_id})
        self.assertEqual(status, 200)
        plan = dispatched["plan"]
        by_id = {task["id"]: task for task in plan["subtasks"]}
        self.assertIn(by_id["subtask-1-contract-validation"]["status"], ("completed", "skipped"))
        self.assertEqual(by_id["subtask-2-core-implementation"]["status"], "dispatched")
        self.assertIn("[CORTEX-OS SYNC", by_id["subtask-2-core-implementation"].get("payload", ""))

        # Confirm the cloud subtask, settle the rest.
        status, _, _ = _request("POST", "/cto", {
            "action": "UPDATE_SUBTASK", "planId": plan_id,
            "subtaskId": "subtask-2-core-implementation", "status": "completed",
        })
        self.assertEqual(status, 200)
        status, settled, _ = _request("POST", "/cto", {"action": "DISPATCH_PLAN", "planId": plan_id})
        self.assertEqual(status, 200)
        self.assertEqual(settled["plan"]["status"], "completed")

        # ARCHIVE
        status, archived, _ = _request("POST", "/cto", {"action": "ARCHIVE_PLAN", "planId": plan_id})
        self.assertEqual(status, 200)
        self.assertEqual(archived["plan"]["status"], "archived")

    # ------------------------------------------------------------------
    # 4. Validation envelopes
    # ------------------------------------------------------------------

    def test_30_validation_envelopes(self):
        status, state, _ = _request("GET", "/state")
        self.assertEqual(status, 200)
        project_id = self._project_id(state)

        status, _, _ = _request("POST", "/cto", {"action": "BUILD_DAG_PLAN", "projectId": project_id, "goal": "x"})
        self.assertEqual(status, 422)

        status, _, _ = _request("POST", "/state", {"projectId": project_id, "action": "NOPE"})
        self.assertEqual(status, 422)

        status, _, _ = _request("POST", "/cto", {"action": "DISPATCH_PLAN", "planId": "no-such-plan"})
        self.assertEqual(status, 404)

        status, _, _ = _request("GET", "/state?project=no-such-project")
        self.assertEqual(status, 404)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _project_id(self, state: dict) -> str:
        """The state response does not echo the resolved id directly; resolve
        it from the projects list by slug."""
        status, projects_payload, _ = _request("GET", "/projects")
        self.assertEqual(status, 200)
        slug = state.get("projectSlug")
        for project in projects_payload["projects"]:
            if project["slug"] == slug:
                return project["id"]
        self.fail(f"project {slug} not found in /projects")


if __name__ == "__main__":
    unittest.main()
