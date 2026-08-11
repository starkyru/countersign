# EU AI Act Article 14 for agent teams

This guide is a product implementation aid, not legal advice. It does not
determine whether a system is high-risk, whether the EU AI Act applies to a
particular deployment, or whether any control achieves compliance. Get advice
from qualified counsel for those questions.

The relevant baseline is [Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en).
For high-risk systems within scope, Article 12 addresses automatic event logs
and traceability; Article 14 addresses effective human oversight by natural
persons. Requirements, responsibilities, and applicability vary by role
(provider/deployer), intended purpose, system classification, and timing.

## What a reviewer console can support

| Practical question | Relevant control surface | Countersign evidence/control today | What the team must still own |
| --- | --- | --- | --- |
| Can a person understand the action before it occurs? | Clear request context, action arguments, and output interpretation | Action request, description, graph/thread provenance, structured edit schema, and field-level diff primitive | Risk-appropriate UX, reviewer training, and system-specific instructions for use |
| Can a person intervene or stop the action? | Approval boundary, allowed decision controls, reject/response path, and execution-status reporting | LangGraph `interrupt()`/resume mapping, allow flags, rejection path, post-resume `halted`/`failed` events | A deployer-approved stop procedure and escalation authority |
| Are oversight decisions traceable? | Timestamped event history with actor and decision context | Hash-chained request, decision, expiry, and execution events; CSV/JSON/evidence export | Retention schedule, access governance, and storage controls appropriate to the deployment |
| Is the person authorized for the decision? | Role assignment and policy routing | `admin`/`approver`/`viewer` roles, policy-captured quorum, and optional trusted identity provider | Identity lifecycle, training, delegated authority, and production access reviews |
| Can the team investigate a failure? | Original input, edit, policy, runtime outcome, and integrity check | Original action payload, edit decision, captured policy, execution outcome, audit verification and offline verification CLI | Incident response, monitoring, root-cause process, and connection to broader technical logs |

## A practical operating pattern

1. Identify which agent actions can cause material impact and define a policy
   per action, graph node, and—where useful—amount threshold.
2. Include a short reviewer-facing description, the exact proposed arguments,
   provenance, and an edit schema when edits are safe.
3. Require a trusted identity in any environment where reviewer attribution
   matters. Route higher-risk requests to an appropriate quorum.
4. Resume the graph only through the recorded decision path, then append its
   `completed`, `failed`, or `halted` execution outcome.
5. Periodically export and verify evidence, test restore paths, and review
   whether policy, reviewer authorization, and escalation arrangements remain
   appropriate.

## Controls that are intentionally not solved by an approval inbox

An approval console is one component, not a compliance program. Teams still
need to assess classification and applicability, manage risk, document the
system, provide instructions and training, govern personal data, secure
infrastructure, handle incidents, and maintain retention/oversight processes.

In particular, a hash chain detects altered event histories in an export; it
does not replace database access controls, encryption, retention policy, or an
externally managed signing key. The SQLite quickstart is a local evaluation
path, not a production claim.

## Review prompts for the team

- Does the reviewer have enough context to decide without guessing?
- Does the reviewer have the authority and time to reject or halt the action?
- Is the permitted action set constrained so an approval cannot be repurposed?
- Are decision, policy, actor, and runtime outcome retained in a reviewable
  form for the right period?
- Has the team tested what happens when a reviewer is unavailable or the agent
  fails after approval?

Use the [Sprint 0 evidence checklist](sprint-0/eu-ai-act-oversight-evidence-checklist.md)
for the field-level mapping and retain counsel-approved requirements alongside
the operational runbook.
