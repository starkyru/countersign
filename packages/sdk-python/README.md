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

Do not create a random request ID inside an interrupted node. LangGraph reruns
that node on resume; leave the ID absent or derive a stable ID from graph
state.

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
