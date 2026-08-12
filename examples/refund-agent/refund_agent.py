"""A runnable LangGraph approval spike using the Countersign v0 request.

The approval node deliberately performs no side effects before ``interrupt``:
LangGraph replays the whole node when a reviewer resumes the thread.
"""

from __future__ import annotations

import argparse
import json
import os
import uuid
from datetime import UTC, datetime
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt


class RefundState(TypedDict, total=False):
    approval_request: dict[str, Any]
    decision: Literal["approved", "rejected"]
    approved_args: dict[str, Any]
    outcome: str
    refunded_amount_usd: float


def build_refund_request(
    *,
    request_id: str,
    thread_id: str,
    order_id: str,
    amount_usd: float,
) -> dict[str, Any]:
    """Create a native request that is also a valid Agent Inbox HumanInterrupt."""
    return {
        "schema_version": "countersign/v0",
        "id": request_id,
        "action_request": {
            "action": "issue_refund",
            "args": {"order_id": order_id, "amount_usd": amount_usd},
        },
        "config": {
            "allow_ignore": True,
            "allow_respond": True,
            "allow_edit": True,
            "allow_accept": True,
        },
        "description": "Refund requested by the support agent. Review the amount before issuing it.",
        "created_at": datetime.now(UTC).isoformat(),
        "source": {
            "framework": "langgraph",
            "graph_id": "refund-agent",
            "thread_id": thread_id,
            "node": "request_approval",
        },
        "context": {"risk_level": "medium", "labels": ["refund", "customer-support"]},
    }


def _agent_inbox_response(
    response: Any, request: dict[str, Any]
) -> tuple[Literal["approved", "rejected"], dict[str, Any]]:
    """Validate the subset of HumanResponse needed by the toy agent.

    Agent Inbox always returns a one-element response list. Reject/ignore and a
    plain response do not execute a financial action in this conservative demo.
    """
    if not isinstance(response, list) or len(response) != 1 or not isinstance(response[0], dict):
        raise ValueError("Expected a one-element Agent Inbox HumanResponse list")

    human_response = response[0]
    response_type = human_response.get("type")
    if response_type in {"ignore", "response"}:
        return "rejected", request["action_request"]["args"]

    if response_type not in {"accept", "edit"}:
        raise ValueError(f"Unsupported HumanResponse type: {response_type!r}")

    action_request = human_response.get("args")
    if not isinstance(action_request, dict) or action_request.get("action") != "issue_refund":
        raise ValueError("Approval must return an issue_refund ActionRequest")
    args = action_request.get("args")
    if not isinstance(args, dict):
        raise ValueError("Approval ActionRequest.args must be an object")
    if args.get("order_id") != request["action_request"]["args"]["order_id"]:
        raise ValueError("This demo does not permit changing the order ID")

    try:
        amount = float(args["amount_usd"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("amount_usd must be a number") from error
    if not 0 < amount <= 10_000:
        raise ValueError("amount_usd must be greater than 0 and at most 10,000")

    return "approved", {"order_id": args["order_id"], "amount_usd": amount}


def request_approval(state: RefundState) -> Command:
    """Pause until a compatible HumanResponse is supplied via Command(resume=...)."""
    request = state["approval_request"]
    response = interrupt(request)
    decision, approved_args = _agent_inbox_response(response, request)
    if decision == "approved":
        return Command(
            update={"decision": decision, "approved_args": approved_args},
            goto="issue_refund",
        )
    return Command(update={"decision": decision}, goto="reject_refund")


def issue_refund(state: RefundState) -> dict[str, Any]:
    """The only side-effect boundary; a real app would call its payments API here."""
    amount = float(state["approved_args"]["amount_usd"])
    order_id = state["approved_args"]["order_id"]
    return {
        "refunded_amount_usd": amount,
        "outcome": f"Refund for {order_id} issued for ${amount:.2f}",
    }


def reject_refund(state: RefundState) -> dict[str, Any]:
    return {"outcome": "Refund was not issued; reviewer declined or requested a response."}


def build_refund_graph(checkpointer: Any):
    builder = StateGraph(RefundState)
    builder.add_node("request_approval", request_approval)
    builder.add_node("issue_refund", issue_refund)
    builder.add_node("reject_refund", reject_refund)
    builder.add_edge(START, "request_approval")
    builder.add_edge("issue_refund", END)
    builder.add_edge("reject_refund", END)
    return builder.compile(checkpointer=checkpointer)


def _response_for_cli(decision: str, request: dict[str, Any], amount_usd: float | None) -> list[dict[str, Any]]:
    if decision == "reject":
        return [{"type": "ignore", "args": None}]
    args = dict(request["action_request"]["args"])
    if amount_usd is not None:
        args["amount_usd"] = amount_usd
    return [{
        "type": "edit" if amount_usd is not None else "accept",
        "args": {"action": "issue_refund", "args": args},
    }]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the persistent Countersign refund approval spike.")
    parser.add_argument("--thread-id", default=f"refund-{uuid.uuid4()}")
    parser.add_argument("--order-id", default="ord_4821")
    parser.add_argument("--amount-usd", type=float, default=129.00)
    parser.add_argument("--decision", choices=("accept", "reject", "edit"), default="edit")
    parser.add_argument("--edited-amount-usd", type=float, default=99.00)
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("Set DATABASE_URL (see README) to use the required Postgres checkpointer.")

    from langgraph.checkpoint.postgres import PostgresSaver

    request = build_refund_request(
        request_id=f"apr_{uuid.uuid4().hex}",
        thread_id=args.thread_id,
        order_id=args.order_id,
        amount_usd=args.amount_usd,
    )
    config = {"configurable": {"thread_id": args.thread_id}}
    with PostgresSaver.from_conn_string(database_url) as checkpointer:
        checkpointer.setup()
        graph = build_refund_graph(checkpointer)
        paused = graph.invoke({"approval_request": request}, config=config)
        payload = paused["__interrupt__"][0].value
        print("INTERRUPT PAYLOAD")
        print(json.dumps(payload, indent=2, default=str))

        edited_amount = args.edited_amount_usd if args.decision == "edit" else None
        response = _response_for_cli(args.decision, request, edited_amount)
        completed = graph.invoke(Command(resume=response), config=config)
        print("\nFINAL STATE")
        print(json.dumps(completed, indent=2, default=str))


if __name__ == "__main__":
    main()
