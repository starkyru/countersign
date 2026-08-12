# Refund approval example

This small LangGraph agent pauses before `issue_refund`, emits a Countersign v0
request, and performs the fake refund only after a compatible resume value.

It runs on the published SDK rather than a hand-built payload:

- `require_approval()` wraps the refund action, so the interrupt, the decision
  parsing, and the post-approval execution all come from `countersign`;
- `build_approval_request()` produces the v0 request, including the
  `edit_schema` that pins the order ID and bounds the amount — the reviewer's
  form validates against it, and `require_approval()` enforces it again inside
  the graph, where the resume payload is untrusted;
- `resume_command()` turns an `ApprovalDecision` into the `Command(resume=...)`
  value the graph expects, which is the same mapping the console uses.

Reject and respond decisions raise `ApprovalRejected`, so neither one reaches
the payments call.

## Run locally

From this directory:

```sh
uv run --group dev pytest
uv run python refund_agent.py --decision edit --edited-amount-usd 99
```

The local editable `countersign-ai` distribution is configured in
`pyproject.toml`; application code still imports `countersign`.

The command prints the interrupt payload and resumed graph state. The example
keeps the side effect after the interrupt because LangGraph reruns the paused
node from the beginning on resume.

## Durable Postgres checkpoint

Point the example at an existing disposable Postgres database:

```sh
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable'
COUNTERSIGN_TEST_POSTGRES="$DATABASE_URL" uv run --group dev pytest
```

The durable test pauses the graph, closes its first `PostgresSaver`, opens a
new checkpointer, and resumes the same thread. The database lifecycle is left
to the developer so this public example does not ship production service
configuration.

## Agent Inbox compatibility

Run the local LangGraph API:

```sh
uv run --group dev langgraph dev --host 127.0.0.1 --port 2024 --no-browser
```

In another terminal, seed a paused thread:

```sh
uv run python agent_inbox_seed.py
```

Point the upstream Agent Inbox at `http://127.0.0.1:2024` with graph ID
`refund-agent`. See `docs/sprint-0/agent-inbox-compatibility.md` for the
verified wire contract.

## LangGraph Platform probe

`platform_spike.py` prints the REST request shape without credentials:

```sh
uv run python platform_spike.py --dry-run
```

For a real assistant, set `LANGGRAPH_API_URL`, `LANGGRAPH_API_KEY`, and
`LANGGRAPH_ASSISTANT_ID`. No deployment credential is stored in this
repository.
