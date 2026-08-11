# Agent Inbox compatibility findings

Source inspected: [`langchain-ai/agent-inbox`](https://github.com/langchain-ai/agent-inbox)
commit `f38301b9d0be` (2026-08-05), on Sprint 0 research date 2026-08-09. This
contract was also exercised on 2026-08-11 with the current upstream UI against
the local LangGraph API exported by `examples/refund-agent/langgraph.json`.

## Exact contract

The request passed to `interrupt()` is:

```ts
type HumanInterrupt = {
  action_request: { action: string; args: Record<string, unknown> };
  config: {
    allow_ignore: boolean;
    allow_respond: boolean;
    allow_edit: boolean;
    allow_accept: boolean;
  };
  description?: string;
};
```

Agent Inbox resumes the graph with a **one-element list**:

```ts
type HumanResponse = {
  type: "accept" | "ignore" | "response" | "edit";
  args: null | string | { action: string; args: Record<string, unknown> };
};
```

`accept` and `edit` return an `ActionRequest`; the implementation documents
that its form converts argument values to strings. Adapters must validate and
coerce those values against the tool's schema before execution. `response`
returns a string and `ignore` returns `null`.

## Countersign decision

[`packages/schema/approval-request.v0.schema.json`](../../packages/schema/approval-request.v0.schema.json)
keeps those three request fields and all four response variants unchanged. It
adds only optional metadata (`id`, timestamps, `source`, and `context`). A
plain `HumanInterrupt` is valid v0 input. The server, not the agent process,
will assign a persisted request ID when the agent provides none.

The toy agent is the executable proof: it emits the v0 request and accepts the
Agent Inbox response list unchanged at its LangGraph boundary. In the browser
exercise, Agent Inbox discovered the interrupted `issue_refund` thread, exposed
editable `order_id` and `amount_usd` fields, and submitted an `edit` response.
Changing `129` to `99` completed the graph with:

```json
{
  "decision": "approved",
  "approved_args": {"order_id": "ord_4821", "amount_usd": 99.0},
  "outcome": "Refund for ord_4821 issued for $99.00"
}
```

`examples/refund-agent/agent_inbox_seed.py` makes the local paused thread
reproducible. The local deployment uses no API key; Agent Inbox stores its
inbox configuration in `inbox:agent_inboxes` browser local storage.

## Current upstream UI break

At the inspected commit, selecting an interrupt crashes the task-detail view
before the edit form renders. `src/components/ui/markdown-text.tsx` forwards a
`className` prop to `react-markdown` v10, which rejects that removed prop with
`Unexpected className prop`. A temporary local checkout patch that consumes
the class on a wrapper allowed the end-to-end edit/resume exercise above to
complete. This is an upstream UI dependency regression, not a mismatch in the
Countersign interrupt or response schema.

## Observed product limitations to validate in interviews

- The app asks for a LangSmith API key when a remote deployment requires one,
  and stores the key in browser `localStorage`; it is not a
  server-held-credential, multi-user model. A local LangGraph API works without
  a key.
- The app edits `action_request.args` as UI values and ships the resulting
  stringified values; it does not carry a JSON Schema or perform domain-level
  validation before the graph receives the response.
- The repository's interrupt handling calls the deployment's thread and run
  APIs directly. It has no durable application-level decision/audit model,
  reviewer identity, routing, or role model in the observed schema and flow.

These are compatibility and product observations, not a security assessment.
