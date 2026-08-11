# Approval-console oversight evidence checklist

This is a product-design checklist, not legal advice or a determination that a
system is high risk. It maps an approval console to the operational evidence
that may help a deployer satisfy the record-keeping and human-oversight
requirements in Articles 12 and 14 of the EU AI Act. Confirm applicability,
retention periods, and controls with qualified counsel.

Primary source: [Regulation (EU) 2024/1689 on EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en).

| Evidence to retain | Why an approval console should capture it | v0 / roadmap home |
| --- | --- | --- |
| Original proposed action, arguments, and readable context | Lets a reviewer and later investigator understand what the system proposed. | `action_request`, `description`, `context` |
| Agent, graph, thread, run, checkpoint, and node references | Connects a decision to the system event and permits reconstruction. | `source` |
| Request, assignment, decision, and escalation timestamps | Supports traceability, response-time analysis, and timely intervention evidence. | `created_at`, `expires_at`; append-only audit in Sprint 3 |
| Reviewer identity, role, and authority at decision time | Shows that an appropriately authorized natural person performed the oversight. | Sprint 3 auth/RBAC/audit |
| Decision, reason, original payload, edited payload, and validation result | Demonstrates informed intervention rather than an unexplained click. | Agent Inbox response mapping; structured edit validation in Sprint 1; audit in Sprint 3 |
| Policy/routing version, risk classification, and required approval count | Shows which controls were configured for the action. | `context.risk_level`; routing/two-person rule in Sprint 3 |
| Outcome after resume, failures, overrides, and emergency stop actions | Connects the human decision to the actual system behavior and ability to intervene/halt. | `execution_resumed`, `execution_completed`, `execution_failed`, and `execution_halted` audit events; operational emergency-stop controls remain deployment-specific. |
| Tamper-evident export, access controls, and retention/deletion policy | Makes logs usable and protected for evidence collection. | append-only export and security/retention controls in Sprints 3–5 |

## Minimum product guardrails

- Render the action and its consequences in a form a reviewer can understand;
  never require a raw JSON-only approval for material actions.
- Let a reviewer approve, reject/stop, and modify an action when policy allows.
- Treat timeout and escalation as explicit policy outcomes, never a silent
  auto-approve default.
- Preserve the original request and the final resumed value separately.
- Make audit records append-only and exportable, and redact/minimize personal
  data according to the deployer's retention and privacy obligations.
- Keep the graph's checkpoint as execution truth; store enough references in
  Countersign to correlate, not a conflicting copy of graph state.
