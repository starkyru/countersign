"""Adapters for resuming approvals in self-hosted and Platform LangGraph runs."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol, cast

from .approval import resume_command
from .models import ApprovalDecision, ApprovalRequest


class GraphInvoker(Protocol):
    """Minimal surface of a compiled LangGraph graph needed for a resume."""

    def invoke(self, input_value: Any, config: Mapping[str, Any]) -> Any: ...


class SelfHostedLangGraphAdapter:
    """Resume a paused graph directly through its in-process checkpointer."""

    def resume(
        self,
        graph: GraphInvoker,
        *,
        config: Mapping[str, Any],
        request: ApprovalRequest,
        decision: ApprovalDecision,
    ) -> Any:
        return graph.invoke(resume_command(decision, request), config)


class LangGraphPlatformAdapter:
    """Small REST/SSE client for a LangGraph Platform deployment.

    A Platform run uses the same Agent Inbox-compatible resume payload as an
    in-process graph. The only difference is that it is sent inside a
    `/threads/{thread_id}/runs/stream` POST and results arrive as SSE text.
    """

    def __init__(self, *, base_url: str, api_key: str, client: Any | None = None) -> None:
        try:
            import httpx
        except ImportError as error:  # pragma: no cover - exercised by import guidance
            raise RuntimeError("Install Platform dependencies with `pip install 'countersign-ai[platform]'`") from error
        self._base_url = base_url.rstrip("/")
        self._owns_client = client is None
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._client: Any = client or httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            timeout=30,
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def create_thread(self, thread_id: str, metadata: Mapping[str, Any] | None = None) -> dict[str, Any]:
        response = await self._client.post(
            "/threads",
            json={"thread_id": thread_id, "metadata": dict(metadata or {})},
            headers=self._headers,
        )
        response.raise_for_status()
        return cast(dict[str, Any], response.json())

    async def start_run(
        self,
        *,
        thread_id: str,
        assistant_id: str,
        input_value: Mapping[str, Any],
    ) -> str:
        return await self._stream_run(
            thread_id=thread_id,
            payload={"assistant_id": assistant_id, "input": dict(input_value), "stream_mode": ["values"]},
        )

    async def resume(
        self,
        *,
        thread_id: str,
        assistant_id: str,
        request: ApprovalRequest,
        decision: ApprovalDecision,
    ) -> str:
        command = resume_command(decision, request)
        return await self._stream_run(
            thread_id=thread_id,
            payload={
                "assistant_id": assistant_id,
                "command": {"resume": command.resume},
                "stream_mode": ["values"],
            },
        )

    async def _stream_run(self, *, thread_id: str, payload: Mapping[str, Any]) -> str:
        response = await self._client.post(
            f"/threads/{thread_id}/runs/stream", json=dict(payload), headers=self._headers
        )
        response.raise_for_status()
        return cast(str, response.text)
