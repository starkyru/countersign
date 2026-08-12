"""A runnable LangGraph approval spike built on the Countersign SDK.

The approval node performs no side effects before ``interrupt``: LangGraph
replays the whole node when a reviewer resumes the thread, and
``require_approval`` runs the wrapped action only after a compatible decision
arrives.
"""

from __future__ import annotations

import argparse
import json
import os
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Literal, TypedDict

from countersign import (
    ApprovalContext,
    ApprovalDecision,
    ApprovalRejected,
    ApprovalRequest,
    HumanInterruptConfig,
    InterruptSource,
    build_approval_request,
    require_approval,
    resume_command,
)
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

MAX_REFUND_USD = 10_000.0

def edit_schema(order_id: str) -> dict[str, Any]:
    """Constrain what a reviewer may change about this particular refund.

    The React edit form renders and validates against this schema, and
    ``require_approval`` enforces it again inside the graph, where the resume
    payload is untrusted. Pinning the order ID with ``const`` means an edit can
    only move the amount.
    """
    return {
        "type": "object",
        "required": ["order_id", "amount_usd"],
        "additionalProperties": False,
        "properties": {
            "order_id": {"const": order_id},
            "amount_usd": {
                "type": "number",
                "exclusiveMinimum": 0,
                "maximum": MAX_REFUND_USD,
            },
        },
    }


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
    request = build_approval_request(
        action="issue_refund",
        args={"order_id": order_id, "amount_usd": amount_usd},
        description="Refund requested by the support agent. Review the amount before issuing it.",
        config=HumanInterruptConfig(),
        request_id=request_id,
        source=InterruptSource(
            framework="langgraph",
            graph_id="refund-agent",
            thread_id=thread_id,
            node="request_approval",
        ),
        created_at=datetime.now(UTC),
        context=ApprovalContext(
            risk_level="medium",
            labels=["refund", "customer-support"],
            edit_schema=edit_schema(order_id),
        ),
    )
    return request.model_dump(mode="json", exclude_none=True)


def issue_refund(order_id: str, amount_usd: float) -> dict[str, Any]:
    """The only side-effect boundary; a real app would call its payments API here.

    The edit schema bounds what a *reviewer* may submit, but it says nothing
    about the arguments the graph proposed in the first place. The action keeps
    its own limit so an accepted-as-proposed refund is bounded too.
    """
    try:
        amount = float(amount_usd)
    except (TypeError, ValueError) as error:
        raise ValueError("amount_usd must be a number") from error
    if not 0 < amount <= MAX_REFUND_USD:
        raise ValueError(f"amount_usd must be greater than 0 and at most {MAX_REFUND_USD:,.0f}")
    return {
        "order_id": order_id,
        "amount_usd": amount,
        "outcome": f"Refund for {order_id} issued for ${amount:.2f}",
    }


def _guarded_refund(request: ApprovalRequest) -> Callable[..., dict[str, Any]]:
    """Wrap the refund action with the approval configuration of this request.

    The wrapper is rebuilt per call because the request ID, creation time, and
    ``source`` are run-scoped values, while a decorator's options are fixed at
    import time. Building it performs no side effects, so a replayed node is
    safe.
    """
    return require_approval(
        action=request.action_request.action,
        description=request.description,
        config=request.config,
        request_id=request.id,
        created_at=request.created_at,
        source=request.source,
        context=request.context,
    )(issue_refund)


def request_approval(state: RefundState) -> Command:
    """Pause until a decision arrives, then issue the refund or route to rejection.

    ``require_approval`` raises ``ApprovalRejected`` for both reject and respond
    decisions, so neither one reaches the payments call.
    """
    request = ApprovalRequest.model_validate(state["approval_request"])
    try:
        result = _guarded_refund(request)(**request.action_request.args)
    except ApprovalRejected:
        return Command(update={"decision": "rejected"}, goto="reject_refund")

    return Command(
        update={
            "decision": "approved",
            "approved_args": {
                "order_id": result["order_id"],
                "amount_usd": result["amount_usd"],
            },
            "refunded_amount_usd": result["amount_usd"],
            "outcome": result["outcome"],
        },
        goto=END,
    )


def reject_refund(state: RefundState) -> dict[str, Any]:
    return {"outcome": "Refund was not issued; reviewer declined or requested a response."}


def build_refund_graph(checkpointer: Any):
    builder = StateGraph(RefundState)
    builder.add_node("request_approval", request_approval)
    builder.add_node("reject_refund", reject_refund)
    builder.add_edge(START, "request_approval")
    builder.add_edge("reject_refund", END)
    return builder.compile(checkpointer=checkpointer)


def _resume_for_cli(
    choice: str,
    request: ApprovalRequest,
    edited_amount_usd: float | None,
) -> Command[Any]:
    """Build the same `Command(resume=...)` the console produces for a decision."""
    if choice == "reject":
        decision = ApprovalDecision(type="reject", reason="Reviewer declined in the CLI demo")
    elif choice == "edit":
        if edited_amount_usd is None:
            raise SystemExit("--decision edit requires --edited-amount-usd")
        args = dict(request.action_request.args)
        args["amount_usd"] = edited_amount_usd
        decision = ApprovalDecision(type="edit", args=args)
    else:
        decision = ApprovalDecision(type="approve")
    return resume_command(decision, request)


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

    payload = build_refund_request(
        request_id=f"apr_{uuid.uuid4().hex}",
        thread_id=args.thread_id,
        order_id=args.order_id,
        amount_usd=args.amount_usd,
    )
    request = ApprovalRequest.model_validate(payload)
    config = {"configurable": {"thread_id": args.thread_id}}
    with PostgresSaver.from_conn_string(database_url) as checkpointer:
        checkpointer.setup()
        graph = build_refund_graph(checkpointer)
        paused = graph.invoke({"approval_request": payload}, config=config)
        print("INTERRUPT PAYLOAD")
        print(json.dumps(paused["__interrupt__"][0].value, indent=2, default=str))

        edited_amount = args.edited_amount_usd if args.decision == "edit" else None
        completed = graph.invoke(_resume_for_cli(args.decision, request, edited_amount), config=config)
        print("\nFINAL STATE")
        print(json.dumps(completed, indent=2, default=str))


if __name__ == "__main__":
    main()
