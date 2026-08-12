"""Create one paused refund thread for a local Agent Inbox exercise."""

from __future__ import annotations

import argparse
import json
import uuid
from typing import Any
from urllib.request import Request, urlopen

from refund_agent import build_refund_request


def _post_json(url: str, payload: dict[str, Any]) -> Any:
    request = Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=15) as response:  # noqa: S310 - local URL is explicit CLI input
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:2024")
    parser.add_argument(
        "--thread-id",
        default=str(uuid.uuid4()),
        help="LangGraph thread UUID (a random UUID by default)",
    )
    parser.add_argument("--order-id", default="ord_4821")
    parser.add_argument("--amount-usd", type=float, default=129.0)
    args = parser.parse_args()

    api_url = args.api_url.rstrip("/")
    approval_request = build_refund_request(
        request_id=f"apr_{uuid.uuid4().hex}",
        thread_id=args.thread_id,
        order_id=args.order_id,
        amount_usd=args.amount_usd,
    )
    _post_json(f"{api_url}/threads", {"thread_id": args.thread_id})
    paused = _post_json(
        f"{api_url}/threads/{args.thread_id}/runs/wait",
        {"assistant_id": "refund-agent", "input": {"approval_request": approval_request}},
    )

    print(f"Paused thread: {args.thread_id}")
    print(f"Agent Inbox deployment URL: {api_url}")
    print("Agent Inbox graph ID: refund-agent")
    print(json.dumps(paused, indent=2, default=str))


if __name__ == "__main__":
    main()
