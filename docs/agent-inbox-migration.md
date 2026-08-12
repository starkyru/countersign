# Migrating an Agent Inbox interrupt to Countersign

Countersign accepts Agent Inbox's `HumanInterrupt` payload unchanged. An
existing LangGraph graph can keep its `interrupt()` call while its trusted
host forwards the resulting payload to a reviewer UI or approval service.

## 1. Keep the existing interrupt

```python
from langgraph.types import interrupt

review = interrupt({
    "action_request": {
        "action": "issue_refund",
        "args": {"order_id": "ord_4821", "amount_usd": 129},
    },
    "config": {
        "allow_ignore": True,
        "allow_respond": True,
        "allow_edit": True,
        "allow_accept": True,
    },
    "description": "Review this refund before it is issued.",
})
```

Validate the payload at the integration boundary:

```python
from countersign import ApprovalRequest

request = ApprovalRequest.model_validate(interrupt_payload)
```

## 2. Add optional context

The v0 schema can carry graph provenance and a JSON Schema for editable tool
arguments. All fields remain optional for incremental adoption.

```python
payload.update({
    "schema_version": "countersign/v0",
    "source": {
        "framework": "langgraph",
        "graph_id": "refund-agent",
        "environment": "production",
        "thread_id": thread_id,
        "node": "review_refund",
    },
    "context": {
        "risk_level": "medium",
        "labels": ["refund", "payments"],
        "edit_schema": {
            "type": "object",
            "properties": {"amount_usd": {"type": "number", "minimum": 1}},
            "required": ["amount_usd"],
        },
    },
})
```

## 3. Resume the graph

For an in-process graph, use `resume_command()` directly or the
`SelfHostedLangGraphAdapter`:

```python
from countersign import ApprovalDecision, SelfHostedLangGraphAdapter

result = SelfHostedLangGraphAdapter().resume(
    graph,
    config={"configurable": {"thread_id": "refund-4821"}},
    request=request,
    decision=ApprovalDecision(type="approve"),
)
```

The Platform adapter uses the same decision mapping over REST/SSE. See
[`langgraph-platform.md`](langgraph-platform.md).

## 4. Keep credentials out of the browser

The React `HttpApprovalStore` accepts host-managed headers, but long-lived
LangGraph or service credentials belong behind an application-owned API
boundary. Browser code should receive a short-lived, user-scoped session.

## Compatibility notes

- `accept`, `edit`, `response`, and `ignore` retain Agent Inbox semantics.
- Do not generate a random request ID inside an interrupted node; replay would
  create a different ID.
- Parallel interrupts require an interrupt-ID-keyed resume map.
- Record the reviewer decision separately from the graph execution outcome so
  approval does not imply that the side effect completed.
