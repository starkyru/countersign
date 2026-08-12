"""Drive the refund graph through the LangGraph Platform REST API.

It is credential-free in --dry-run mode. A real run requires a deployed
assistant whose graph is the refund agent and the three environment variables
documented in the adjacent README.
"""

from __future__ import annotations

import argparse
import json
import os
import uuid
from typing import Any
from urllib.request import Request, urlopen

from refund_agent import build_refund_request


def _request(base_url: str, token: str, method: str, path: str, body: dict[str, Any]) -> Any:
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    with urlopen(request, timeout=30) as response:  # nosec B310: URL is explicitly provided by operator
        return json.loads(response.read())


def _stream_request(base_url: str, token: str, path: str, body: dict[str, Any]) -> str:
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=30) as response:  # nosec B310: URL is explicitly provided by operator
        return response.read().decode()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Platform interrupt/resume contract probe.")
    parser.add_argument("--dry-run", action="store_true", help="Print the requests without calling a deployment.")
    args = parser.parse_args()

    thread_id = str(uuid.uuid4())
    request_id = f"apr_{uuid.uuid4().hex}"
    approval_request = build_refund_request(
        request_id=request_id,
        thread_id=thread_id,
        order_id="ord_4821",
        amount_usd=129.0,
    )
    initial_body = {"assistant_id": "<LANGGRAPH_ASSISTANT_ID>", "input": {"approval_request": approval_request}, "stream_mode": ["values"]}
    resume_body = {"assistant_id": "<LANGGRAPH_ASSISTANT_ID>", "command": {"resume": [{"type": "accept", "args": approval_request["action_request"]}]}, "stream_mode": ["values"]}

    if args.dry_run:
        print(json.dumps({
            "create_thread": {"method": "POST", "path": "/threads", "body": {"thread_id": thread_id}},
            "initial_run": {"method": "POST", "path": f"/threads/{thread_id}/runs/stream", "body": initial_body},
            "resume_run": {"method": "POST", "path": f"/threads/{thread_id}/runs/stream", "body": resume_body},
        }, indent=2))
        return

    base_url = os.environ["LANGGRAPH_API_URL"]
    token = os.environ["LANGGRAPH_API_KEY"]
    assistant_id = os.environ["LANGGRAPH_ASSISTANT_ID"]
    initial_body["assistant_id"] = assistant_id
    resume_body["assistant_id"] = assistant_id
    print("Creating Platform thread:", _request(base_url, token, "POST", "/threads", {"thread_id": thread_id}))
    print("Starting run (the endpoint responds with an SSE stream):")
    print(_stream_request(base_url, token, f"/threads/{thread_id}/runs/stream", initial_body))
    print("Resuming run:")
    print(_stream_request(base_url, token, f"/threads/{thread_id}/runs/stream", resume_body))


if __name__ == "__main__":
    main()
