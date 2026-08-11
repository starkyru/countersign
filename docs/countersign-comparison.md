# Countersign vs. Agent Inbox vs. gotoHuman

This is a product-scope comparison, not a claim that one tool fits every
workflow. It was reviewed on 2026-08-11 against the linked public sources;
hosted product capabilities can change independently of this repository.

## The short version

- Choose **Countersign** when a LangGraph team wants to own the approval
  boundary: a portable approval payload, graph/checkpoint provenance, a
  self-hosted local API, policy/quorum rules, and evidence exports that stay
  alongside the graph integration.
- Choose **Agent Inbox** when an existing LangGraph setup already emits its
  `HumanInterrupt` shape and a team wants the closest possible starting point.
  Countersign deliberately accepts that shape to make migration incremental.
- Choose **gotoHuman** when a managed, framework-agnostic review platform,
  configurable review templates, and its existing notification/integration
  surface are the priority.

## Comparison

| Concern | Countersign | Agent Inbox | gotoHuman |
| --- | --- | --- | --- |
| Primary integration model | LangGraph-first SDK and Agent Inbox-compatible wire payload | LangGraph `HumanInterrupt` / `HumanResponse` reference types | Hosted review requests tied to configurable templates and webhooks |
| Review UI ownership | Embeddable React data primitives plus a styled, responsive inbox, action diff, validated edit form, and audit timeline | Closest fit when retaining an existing Agent Inbox flow | Off-the-shelf hosted Agent Inbox and customizable review UI |
| Workflow resume | Generates Agent Inbox-compatible `Command(resume=…)` values; supports self-hosted and Platform adapters | Native LangGraph interrupt/resume model | Review completion is returned to a configured workflow/webhook |
| Approval controls | Ordered policies, roles, quorum, high-value threshold, edit JSON Schema, and expiry rules | Preserve the controls supplied in the existing interrupt | Template fields, review controls, and hosted workflow configuration |
| Audit focus | Request → decision → execution outcome, CSV/JSON evidence export, hash-chain verification, and local backup/verify commands | Use as supplied by the host application | Managed review history and response data APIs; evaluate retention/evidence needs with the vendor |
| Deployment posture | Local FastAPI + SQLite quickstart, Postgres multi-organization server, and tested AWS CDK blueprint; no public hosted deployment yet | Part of the LangGraph ecosystem | Fully managed hosted service according to its public product/docs pages |

## What the comparison does *not* claim

Countersign does not yet claim a live managed deployment, live Slack/SES
delivery, or a deployed EventBridge schedule. The repository implements and
tests organization-scoped Postgres storage, magic-link/GitHub authentication,
the styled component layer, notification contracts, and the AWS blueprint, but
provider credentials and production operations remain deployment work. A team
that needs a managed web UI, no-code templates, and live vendor-operated
notifications immediately should evaluate gotoHuman directly.

Likewise, do not migrate a working Agent Inbox graph only to change its payload
format: Countersign's compatibility goal is to reuse the existing interrupt and
add provenance, policy, audit, and deployment controls at the bridge boundary.

## Current-source notes

- The LangGraph reference currently lists `HumanInterrupt`,
  `HumanInterruptConfig`, `ActionRequest`, and `HumanResponse`, and labels
  those classes deprecated. See the [LangGraph agent reference](https://langchain-ai.github.io/langgraph/reference/agents/).
- gotoHuman documents a hosted Agent Inbox, configurable review UI, review
  templates, webhook completion, and Slack/email notification paths. See its
  [product overview](https://www.gotohuman.com/), [web UI guide](https://docs.gotohuman.com/web-ui), and [request API guide](https://docs.gotohuman.com/send-requests).
- HumanLayer's public repository currently describes CodeLayer as an open-source
  coding-agent IDE while linking legacy HumanLayer SDK documentation. See the
  [HumanLayer repository](https://github.com/humanlayer/humanlayer).
