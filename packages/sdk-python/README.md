# countersign-ai

Typed, LangGraph-native approval boundaries for consequential actions.

The PyPI distribution is `countersign-ai`; Python code imports `countersign`.

```sh
pip install countersign-ai
```

```python
from countersign import require_approval


@require_approval(action="issue_refund", description="Approve this customer refund")
def issue_refund(order_id: str, amount_usd: float) -> str:
    return payments.refund(order_id, amount_usd)
```

Inside a LangGraph node or tool, the wrapper emits a Countersign v0 request via
`interrupt()` and invokes the wrapped function only after an Agent
Inbox-compatible `accept` or `edit` response. `ignore` and `response` raise
`ApprovalRejected`, preventing the action from running accidentally.

## The resume payload is untrusted

A decision arrives from outside the graph, so the wrapper enforces the contract
the request published before the action can run. Each of these raises
`ApprovalContractError` and executes nothing:

- an `accept` when the request set `allow_accept: false`;
- an `edit` when the request set `allow_edit: false`;
- edited arguments that violate `context.edit_schema`
  (`ApprovalEditValidationError`, carrying one `EditValidationIssue` per
  failing field);
- edited arguments the wrapped function cannot be called with.

```python
from countersign import ApprovalContext, require_approval


@require_approval(
    action="issue_refund",
    context=ApprovalContext(
        edit_schema={
            "type": "object",
            "required": ["order_id", "amount_usd"],
            "additionalProperties": False,
            "properties": {
                "order_id": {"const": "ord_4821"},
                "amount_usd": {"type": "number", "exclusiveMinimum": 0, "maximum": 10_000},
            },
        }
    ),
)
def issue_refund(order_id: str, amount_usd: float) -> str:
    return payments.refund(order_id, amount_usd)
```

A request without `context.edit_schema` keeps the permissive Agent Inbox edit
behavior, so existing graphs are unaffected. `validate_approval_edit()` applies
the same rules outside the decorator, and matches `validateApprovalEdit()` in
`@countersign-ai/react` so a reviewer sees the failure before submitting.

An edit schema constrains what a *reviewer* may change. It says nothing about
the arguments the graph proposed, so keep the action's own limits for the
accept path.

## Interoperability

`ApprovalRequest.model_validate()` accepts an existing Agent Inbox
`HumanInterrupt` unchanged. `resume_command()` maps a Countersign decision to
the `Command(resume=[HumanResponse])` shape LangGraph expects:

```python
from countersign import ApprovalDecision, ApprovalRequest, resume_command

request = ApprovalRequest.model_validate(interrupt_payload)
command = resume_command(
    ApprovalDecision(type="edit", args={"amount_usd": 99}),
    request,
)
graph.invoke(command, config={"configurable": {"thread_id": "refund-4821"}})
```

Do not create a random request ID or timestamp inside an interrupted node.
LangGraph reruns that node on resume; leave `request_id` and `created_at`
absent, or pass stable values derived from graph state.

## Adapters

`SelfHostedLangGraphAdapter` resumes a compiled in-process graph. Install the
Platform transport extra for the REST/SSE adapter:

```sh
pip install 'countersign-ai[platform]'
```

```python
from countersign.adapters import LangGraphPlatformAdapter

adapter = LangGraphPlatformAdapter(base_url=platform_url, api_key=api_key)
await adapter.resume(
    thread_id=thread_id,
    assistant_id=assistant_id,
    request=request,
    decision=decision,
)
```

Keep Platform credentials in the trusted server or worker using the adapter,
never in browser code.

## Develop

```sh
uv run --all-extras --group dev pytest -q
uv run --all-extras --group dev mypy src
uv build
```

The hosted queue, team authentication, billing, notification, and production
persistence implementations are intentionally maintained in the private
`countersign-cloud` repository.
