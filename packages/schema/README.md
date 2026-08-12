# Countersign wire schemas

`approval-request.v0.schema.json` is the interchange contract for a proposed
action. It intentionally preserves Agent Inbox's `HumanInterrupt` fields
unchanged:

- `action_request: { action, args }`
- `config: { allow_ignore, allow_respond, allow_edit, allow_accept }`
- optional `description`

Every valid Agent Inbox `HumanInterrupt` is therefore a valid Countersign v0
request. Countersign producers add the optional envelope fields (`id`,
`schema_version`, `created_at`, `source`, and `context`) when they are
available. Consumers must tolerate an Agent Inbox-only request and should
assign a server-side ID before persisting it.

The response stays Agent Inbox-compatible: LangGraph receives a list with one
`{ type: "accept" | "edit" | "response" | "ignore", args: ... }` object.
Countersign's UI may call these actions approve, edit, respond, and reject,
respectively; the adapter owns that mapping.
