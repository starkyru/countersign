from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from countersign import ApprovalDecision, ApprovalRequest, SelfHostedLangGraphAdapter
from countersign.adapters import LangGraphPlatformAdapter


def _request() -> ApprovalRequest:
    return ApprovalRequest.model_validate(
        {
            "action_request": {"action": "issue_refund", "args": {"order_id": "ord_1", "amount_usd": 129}},
            "config": {"allow_ignore": True, "allow_respond": True, "allow_edit": True, "allow_accept": True},
        }
    )


def test_self_hosted_adapter_resumes_a_graph() -> None:
    def node(_: dict[str, Any]) -> dict[str, str]:
        response = interrupt(_request().model_dump(mode="json"))
        return {"outcome": response[0]["type"]}

    graph = StateGraph(dict)
    graph.add_node("review", node)
    graph.add_edge(START, "review")
    graph.add_edge("review", END)
    compiled = graph.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "adapter-local"}}
    compiled.invoke({}, config=config)
    completed = SelfHostedLangGraphAdapter().resume(
        compiled,
        config=config,
        request=_request(),
        decision=ApprovalDecision(type="approve"),
    )
    assert completed["outcome"] == "accept"


@pytest.mark.asyncio
async def test_platform_adapter_uses_thread_and_run_stream_contract() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/threads":
            return httpx.Response(200, json={"thread_id": "thread-platform"})
        return httpx.Response(200, text="event: values\ndata: {}\n\n", headers={"content-type": "text/event-stream"})

    client = httpx.AsyncClient(base_url="https://platform.example", transport=httpx.MockTransport(handler))
    adapter = LangGraphPlatformAdapter(base_url="https://platform.example", api_key="test-key", client=client)
    await adapter.create_thread("thread-platform", {"environment": "test"})
    stream = await adapter.start_run(
        thread_id="thread-platform",
        assistant_id="refund-agent",
        input_value={"approval_request": _request().model_dump(mode="json")},
    )
    resumed = await adapter.resume(
        thread_id="thread-platform",
        assistant_id="refund-agent",
        request=_request(),
        decision=ApprovalDecision(type="edit", args={"order_id": "ord_1", "amount_usd": 99}),
    )
    await client.aclose()

    assert stream.startswith("event: values")
    assert resumed.startswith("event: values")
    assert [request.url.path for request in requests] == [
        "/threads",
        "/threads/thread-platform/runs/stream",
        "/threads/thread-platform/runs/stream",
    ]
    assert requests[0].headers["authorization"] == "Bearer test-key"
    resume_body = json.loads(requests[2].content)
    assert resume_body["command"]["resume"] == [
        {"type": "edit", "args": {"action": "issue_refund", "args": {"order_id": "ord_1", "amount_usd": 99}}}
    ]
