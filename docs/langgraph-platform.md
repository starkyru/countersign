# LangGraph Platform integration

`LangGraphPlatformAdapter` uses the same Countersign request and Agent
Inbox-compatible resume payload as a self-hosted graph. The transport changes:
Platform runs use REST endpoints and return server-sent event text.

## Install and configure

```sh
pip install 'countersign-ai[platform]'
export LANGGRAPH_API_URL='https://your-platform.example'
export LANGGRAPH_API_KEY='…'
export LANGGRAPH_ASSISTANT_ID='…'
```

Keep the Platform key on the server or worker that invokes this adapter. It is
not a browser credential.

## Create a thread and start a run

```python
from countersign.adapters import LangGraphPlatformAdapter

adapter = LangGraphPlatformAdapter(
    base_url=platform_url,
    api_key=platform_api_key,
)
await adapter.create_thread("refund-4821", metadata={"environment": "production"})
stream_text = await adapter.start_run(
    thread_id="refund-4821",
    assistant_id=assistant_id,
    input_value={"order_id": "ord_4821", "amount_usd": 129},
)
```

`stream_text` is the raw SSE response. The host should parse the Platform's
stream events, extract the interrupt payload, validate it with
`ApprovalRequest.model_validate()`, and enqueue it in Countersign.

## Resume after review

```python
from countersign import ApprovalDecision, ApprovalRequest

request = ApprovalRequest.model_validate(interrupt_payload)
stream_text = await adapter.resume(
    thread_id="refund-4821",
    assistant_id=assistant_id,
    request=request,
    decision=ApprovalDecision(type="edit", args={"amount_usd": 99}),
)
```

The adapter sends the generated Agent Inbox-compatible response under
`command.resume` to `/threads/{thread_id}/runs/stream`. This is intentionally
the same decision mapping used by `SelfHostedLangGraphAdapter`.

## Production boundary

The SDK includes contract tests against an HTTP mock and the runnable
`examples/refund-agent/platform_spike.py` probe. A live Platform exercise still
requires a real endpoint, assistant ID, and authorized API key; no deployment
credential is stored in this repository.
