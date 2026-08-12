from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, TypedDict

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from countersign import (
    ApprovalContext,
    ApprovalContractError,
    ApprovalDecision,
    ApprovalEditValidationError,
    ApprovalRejected,
    ApprovalRequest,
    ApprovalRequirement,
    HumanInterruptConfig,
    decision_from_agent_inbox,
    require_approval,
    resume_command,
    validate_approval_edit,
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


def _graph_calling(tool: Callable[[], str]) -> Any:
    def tool_node(_: State) -> dict[str, str]:
        return {"result": tool()}

    builder = StateGraph(State)
    builder.add_node("tool", tool_node)
    builder.add_edge(START, "tool")
    builder.add_edge("tool", END)
    return builder.compile(checkpointer=InMemorySaver())


def _graph() -> Any:
    return _graph_calling(lambda: issue_refund("ord_4821", 129))


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


def test_created_at_is_carried_into_the_interrupt_payload() -> None:
    @require_approval(action="send_email", created_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC))
    def send_email(to: str) -> str:
        return f"sent:{to}"

    graph = _graph_calling(lambda: send_email("a@example.com"))
    paused = graph.invoke({}, config={"configurable": {"thread_id": "sdk-created-at"}})
    assert paused["__interrupt__"][0].value["created_at"] == "2026-01-02T03:04:05Z"


EDIT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["order_id", "amount"],
    "additionalProperties": False,
    "properties": {
        "order_id": {"type": "string", "const": "ord_4821"},
        "amount": {"type": "integer", "minimum": 1, "maximum": 200},
    },
}


@require_approval(action="issue_refund", context=ApprovalContext(edit_schema=EDIT_SCHEMA))
def guarded_refund(order_id: str, amount: int) -> str:
    return f"issued:{order_id}:{amount}"


def _guarded_graph() -> Any:
    return _graph_calling(lambda: guarded_refund("ord_4821", 129))


def _pause(graph: Any, thread_id: str) -> tuple[dict[str, Any], ApprovalRequest]:
    config = {"configurable": {"thread_id": thread_id}}
    paused = graph.invoke({}, config=config)
    return config, ApprovalRequest.model_validate(paused["__interrupt__"][0].value)


def test_edit_inside_the_schema_still_executes() -> None:
    graph = _guarded_graph()
    config, request = _pause(graph, "sdk-edit-valid")
    decision = ApprovalDecision(type="edit", args={"order_id": "ord_4821", "amount": 150})
    completed = graph.invoke(resume_command(decision, request), config=config)
    assert completed["result"] == "issued:ord_4821:150"


def test_edit_outside_the_schema_never_reaches_the_action() -> None:
    graph = _guarded_graph()
    config, request = _pause(graph, "sdk-edit-over-max")
    decision = ApprovalDecision(type="edit", args={"order_id": "ord_4821", "amount": 5_000})
    with pytest.raises(ApprovalEditValidationError) as raised:
        graph.invoke(resume_command(decision, request), config=config)
    assert [(issue.path, issue.keyword) for issue in raised.value.issues] == [("/amount", "maximum")]


def test_edit_cannot_change_a_const_pinned_argument() -> None:
    graph = _guarded_graph()
    config, request = _pause(graph, "sdk-edit-const")
    decision = ApprovalDecision(type="edit", args={"order_id": "ord_9999", "amount": 129})
    with pytest.raises(ApprovalEditValidationError) as raised:
        graph.invoke(resume_command(decision, request), config=config)
    assert [issue.keyword for issue in raised.value.issues] == ["const"]


def test_edit_cannot_smuggle_an_argument_past_the_schema() -> None:
    graph = _guarded_graph()
    config, request = _pause(graph, "sdk-edit-extra")
    decision = ApprovalDecision(
        type="edit", args={"order_id": "ord_4821", "amount": 129, "internal_override": True}
    )
    with pytest.raises(ApprovalEditValidationError) as raised:
        graph.invoke(resume_command(decision, request), config=config)
    assert [issue.keyword for issue in raised.value.issues] == ["additionalProperties"]


def test_unknown_argument_is_refused_when_no_schema_is_published() -> None:
    graph = _graph()
    config, request = _pause(graph, "sdk-edit-unbindable")
    decision = ApprovalDecision(
        type="edit", args={"order_id": "ord_4821", "amount": 129, "surprise": 1}
    )
    with pytest.raises(ApprovalContractError, match="Edited arguments do not match issue_refund"):
        graph.invoke(resume_command(decision, request), config=config)


def test_edit_is_refused_when_the_request_disallows_editing() -> None:
    @require_approval(
        action="issue_refund",
        config=HumanInterruptConfig(allow_edit=False),
    )
    def no_edit_refund(order_id: str, amount: int) -> str:
        return f"issued:{order_id}:{amount}"

    graph = _graph_calling(lambda: no_edit_refund("ord_4821", 129))
    config, request = _pause(graph, "sdk-edit-disallowed")
    decision = ApprovalDecision(type="edit", args={"order_id": "ord_4821", "amount": 1})
    with pytest.raises(ApprovalEditValidationError, match="Editing is disabled for this approval"):
        graph.invoke(resume_command(decision, request), config=config)


def test_accept_is_refused_when_the_request_disallows_accepting() -> None:
    @require_approval(
        action="issue_refund",
        config=HumanInterruptConfig(allow_accept=False),
    )
    def edit_only_refund(order_id: str, amount: int) -> str:
        return f"issued:{order_id}:{amount}"

    graph = _graph_calling(lambda: edit_only_refund("ord_4821", 129))
    config, request = _pause(graph, "sdk-accept-disallowed")
    with pytest.raises(ApprovalContractError, match="does not allow an accept decision"):
        graph.invoke(resume_command(ApprovalDecision(type="approve"), request), config=config)


def test_validate_approval_edit_reports_every_failing_field() -> None:
    request = ApprovalRequest.model_validate(
        {
            "action_request": {"action": "issue_refund", "args": {"order_id": "ord_4821", "amount": 129}},
            "config": {"allow_ignore": True, "allow_respond": True, "allow_edit": True, "allow_accept": True},
            "context": {"edit_schema": EDIT_SCHEMA},
        }
    )
    issues = validate_approval_edit(request, {"order_id": "ord_9999", "amount": 5_000})
    assert [(issue.path, issue.keyword) for issue in issues] == [("/amount", "maximum"), ("/order_id", "const")]


def test_a_request_without_an_edit_schema_stays_permissive() -> None:
    request = ApprovalRequest.model_validate(
        {
            "action_request": {"action": "send_email", "args": {"to": "a@example.com"}},
            "config": {"allow_ignore": True, "allow_respond": True, "allow_edit": True, "allow_accept": True},
        }
    )
    assert validate_approval_edit(request, {"to": "anything@example.com"}) == []


def test_an_unusable_edit_schema_is_reported_instead_of_ignored() -> None:
    request = ApprovalRequest.model_validate(
        {
            "action_request": {"action": "send_email", "args": {"to": "a@example.com"}},
            "config": {"allow_ignore": True, "allow_respond": True, "allow_edit": True, "allow_accept": True},
            "context": {"edit_schema": {"type": "not-a-json-schema-type"}},
        }
    )
    issues = validate_approval_edit(request, {"to": "a@example.com"})
    assert [(issue.path, issue.keyword) for issue in issues] == [("schema", "schema")]
