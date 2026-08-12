from __future__ import annotations

from typing import Any, TypedDict

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from countersign import (
    ApprovalDecision,
    ApprovalRejected,
    ApprovalRequest,
    ApprovalRequirement,
    decision_from_agent_inbox,
    require_approval,
    resume_command,
)


def test_agent_inbox_request_needs_no_migration() -> None:
    request = ApprovalRequest.model_validate(
        {
            "action_request": {"action": "send_email", "args": {"to": "a@example.com"}},
            "config": {
                "allow_ignore": True,
                "allow_respond": True,
                "allow_edit": False,
                "allow_accept": True,
            },
            "description": "Existing Agent Inbox request",
        }
    )
    assert request.action_request.action == "send_email"
    assert request.id is None


def test_approval_requirement_is_carried_in_the_wire_model() -> None:
    request = ApprovalRequest.model_validate(
        {
            "action_request": {"action": "issue_refund", "args": {"amount": 120}},
            "config": {"allow_ignore": True, "allow_respond": True, "allow_edit": True, "allow_accept": True},
            "approval_requirement": {
                "policy_id": "refund-two-person",
                "required_approvals": 2,
                "allowed_roles": ["approver", "admin"],
            },
        }
    )
    assert request.approval_requirement == ApprovalRequirement(
        policy_id="refund-two-person", required_approvals=2, allowed_roles=["approver", "admin"]
    )


def test_decision_round_trip_preserves_edited_args() -> None:
    request = ApprovalRequest.model_validate(
        {
            "action_request": {"action": "issue_refund", "args": {"amount": 120}},
            "config": {"allow_ignore": True, "allow_respond": True, "allow_edit": True, "allow_accept": True},
        }
    )
    command = resume_command(ApprovalDecision(type="edit", args={"amount": 99}), request)
    decision = decision_from_agent_inbox(command.resume)
    assert decision.type == "edit"
    assert decision.args == {"amount": 99}


class State(TypedDict, total=False):
    result: str


@require_approval(action="issue_refund", description="Approve this customer refund")
def issue_refund(order_id: str, amount: int) -> str:
    return f"issued:{order_id}:{amount}"


def _graph() -> Any:
    def tool_node(_: State) -> dict[str, str]:
        return {"result": issue_refund("ord_4821", 129)}

    builder = StateGraph(State)
    builder.add_node("tool", tool_node)
    builder.add_edge(START, "tool")
    builder.add_edge("tool", END)
    return builder.compile(checkpointer=InMemorySaver())


def test_decorator_emits_v0_request_and_executes_after_acceptance() -> None:
    graph = _graph()
    config = {"configurable": {"thread_id": "sdk-accept"}}
    paused = graph.invoke({}, config=config)
    payload = paused["__interrupt__"][0].value
    assert payload["action_request"] == {"action": "issue_refund", "args": {"order_id": "ord_4821", "amount": 129}}
    assert payload["schema_version"] == "countersign/v0"

    completed = graph.invoke(
        resume_command(ApprovalDecision(type="approve"), ApprovalRequest.model_validate(payload)), config=config
    )
    assert completed["result"] == "issued:ord_4821:129"


def test_decorator_runs_the_edited_tool_call() -> None:
    graph = _graph()
    config = {"configurable": {"thread_id": "sdk-edit"}}
    paused = graph.invoke({}, config=config)
    payload = ApprovalRequest.model_validate(paused["__interrupt__"][0].value)
    completed = graph.invoke(
        resume_command(ApprovalDecision(type="edit", args={"order_id": "ord_4821", "amount": 99}), payload),
        config=config,
    )
    assert completed["result"] == "issued:ord_4821:99"


def test_rejection_prevents_the_action() -> None:
    graph = _graph()
    config = {"configurable": {"thread_id": "sdk-reject"}}
    paused = graph.invoke({}, config=config)
    payload = ApprovalRequest.model_validate(paused["__interrupt__"][0].value)
    with pytest.raises(ApprovalRejected):
        graph.invoke(resume_command(ApprovalDecision(type="reject"), payload), config=config)
