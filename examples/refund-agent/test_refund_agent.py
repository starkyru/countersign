import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
from countersign import (
    ApprovalDecision,
    ApprovalEditValidationError,
    ApprovalRequest,
    resume_command,
)
from jsonschema import Draft202012Validator
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from interrupt_semantics import build_parallel_graph, build_subgraph_graph
from refund_agent import build_refund_graph, build_refund_request


def _request() -> dict:
    return build_refund_request(
        request_id="apr_test_1",
        thread_id="refund-test",
        order_id="ord_4821",
        amount_usd=129.0,
    )


def test_schema_accepts_native_and_plain_agent_inbox_requests() -> None:
    schema_path = Path(__file__).parents[2] / "packages/schema/approval-request.v0.schema.json"
    schema = json.loads(schema_path.read_text())
    validator = Draft202012Validator(schema)
    native_errors = list(validator.iter_errors(_request()))
    assert native_errors == []

    human_interrupt = {
        "action_request": {"action": "send_email", "args": {"to": "review@example.com"}},
        "config": {"allow_ignore": True, "allow_respond": True, "allow_edit": False, "allow_accept": True},
        "description": "Agent Inbox-only request",
    }
    assert list(validator.iter_errors(human_interrupt)) == []


def test_request_is_agent_inbox_compatible_and_accepts() -> None:
    graph = build_refund_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "refund-accept"}}
    request = _request()
    paused = graph.invoke({"approval_request": request}, config=config)

    payload = paused["__interrupt__"][0].value
    assert set(("action_request", "config")) <= payload.keys()
    assert payload["action_request"]["action"] == "issue_refund"
    assert payload["source"]["thread_id"] == "refund-test"

    response = [{"type": "accept", "args": payload["action_request"]}]
    completed = graph.invoke(Command(resume=response), config=config)
    assert completed["decision"] == "approved"
    assert completed["refunded_amount_usd"] == 129.0


def test_edit_before_approve_changes_the_executed_amount() -> None:
    graph = build_refund_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "refund-edit"}}
    request = _request()
    graph.invoke({"approval_request": request}, config=config)

    response = [{"type": "edit", "args": {"action": "issue_refund", "args": {"order_id": "ord_4821", "amount_usd": 99.0}}}]
    completed = graph.invoke(Command(resume=response), config=config)
    assert completed["decision"] == "approved"
    assert completed["refunded_amount_usd"] == 99.0


def test_ignore_never_issues_a_refund() -> None:
    graph = build_refund_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "refund-reject"}}
    graph.invoke({"approval_request": _request()}, config=config)
    completed = graph.invoke(Command(resume=[{"type": "ignore", "args": None}]), config=config)
    assert completed["decision"] == "rejected"
    assert "not issued" in completed["outcome"]
    assert "refunded_amount_usd" not in completed


def test_respond_never_issues_a_refund() -> None:
    graph = build_refund_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "refund-respond"}}
    graph.invoke({"approval_request": _request()}, config=config)

    response = [{"type": "response", "args": "Attach the order screenshot first."}]
    completed = graph.invoke(Command(resume=response), config=config)
    assert completed["decision"] == "rejected"
    assert "refunded_amount_usd" not in completed


def test_edit_cannot_change_the_order_id() -> None:
    graph = build_refund_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "refund-edit-order"}}
    graph.invoke({"approval_request": _request()}, config=config)

    response = [{
        "type": "edit",
        "args": {"action": "issue_refund", "args": {"order_id": "ord_9999", "amount_usd": 129.0}},
    }]
    with pytest.raises(ApprovalEditValidationError) as raised:
        graph.invoke(Command(resume=response), config=config)
    assert [(issue.path, issue.keyword) for issue in raised.value.issues] == [("/order_id", "const")]


def test_edit_above_the_maximum_never_executes() -> None:
    graph = build_refund_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "refund-edit-max"}}
    graph.invoke({"approval_request": _request()}, config=config)

    response = [{
        "type": "edit",
        "args": {"action": "issue_refund", "args": {"order_id": "ord_4821", "amount_usd": 10_000.01}},
    }]
    with pytest.raises(ApprovalEditValidationError) as raised:
        graph.invoke(Command(resume=response), config=config)
    assert [(issue.path, issue.keyword) for issue in raised.value.issues] == [("/amount_usd", "maximum")]


def test_accepting_an_over_limit_proposal_still_fails_closed() -> None:
    """The edit schema bounds reviewer edits; the action bounds what it was asked to do."""
    graph = build_refund_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "refund-accept-over-max"}}
    request = build_refund_request(
        request_id="apr_test_over_limit",
        thread_id="refund-test",
        order_id="ord_4821",
        amount_usd=25_000.0,
    )
    paused = graph.invoke({"approval_request": request}, config=config)

    response = [{"type": "accept", "args": paused["__interrupt__"][0].value["action_request"]}]
    with pytest.raises(ValueError, match="at most 10,000"):
        graph.invoke(Command(resume=response), config=config)


def test_resume_command_from_a_console_decision_drives_the_graph() -> None:
    graph = build_refund_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "refund-resume-command"}}
    payload = _request()
    graph.invoke({"approval_request": payload}, config=config)

    request = ApprovalRequest.model_validate(payload)
    decision = ApprovalDecision(type="edit", args={"order_id": "ord_4821", "amount_usd": 99.0})
    completed = graph.invoke(resume_command(decision, request), config=config)
    assert completed["decision"] == "approved"
    assert completed["refunded_amount_usd"] == 99.0
    assert completed["approved_args"] == {"order_id": "ord_4821", "amount_usd": 99.0}
    assert completed["outcome"] == "Refund for ord_4821 issued for $99.00"


def test_interrupt_payload_publishes_the_edit_schema_and_provenance() -> None:
    graph = build_refund_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "refund-edit-schema"}}
    request = _request()
    paused = graph.invoke({"approval_request": request}, config=config)

    payload = paused["__interrupt__"][0].value
    assert payload["id"] == "apr_test_1"
    # The reviewer must see the same request the graph recorded, not a value
    # regenerated inside a node that LangGraph replays on resume.
    assert payload["created_at"] == request["created_at"]
    assert payload["context"]["edit_schema"]["properties"]["amount_usd"]["maximum"] == 10_000.0
    assert payload["context"]["edit_schema"]["properties"]["order_id"] == {"const": "ord_4821"}
    assert payload["context"]["edit_schema"]["required"] == ["order_id", "amount_usd"]


def test_parallel_interrupts_require_an_id_keyed_resume_map() -> None:
    graph = build_parallel_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "parallel-test"}}
    paused = graph.invoke({"answers": []}, config=config)
    interrupts = paused["__interrupt__"]
    assert len(interrupts) == 2
    completed = graph.invoke(
        Command(resume={item.id: item.value["review"] for item in interrupts}), config=config
    )
    assert sorted(completed["answers"]) == ["a:a", "b:b"]


def test_interrupt_from_subgraph_resumes_on_the_parent_thread() -> None:
    graph = build_subgraph_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "subgraph-test"}}
    paused = graph.invoke({"reviewed": ""}, config=config)
    item = paused["__interrupt__"][0]
    assert item.value == {"review": "subgraph"}
    # invoke() surfaces only the interrupt ID/payload; the child task carries
    # the checkpoint namespace needed to correlate nested execution.
    child_task = graph.get_state(config).tasks[0]
    assert child_task.state["configurable"]["checkpoint_ns"].startswith("child:")
    completed = graph.invoke(Command(resume="approved"), config=config)
    assert completed["reviewed"] == "approved"


def test_postgres_checkpointer_persists_interrupt_across_graph_reopen() -> None:
    database_url = os.environ.get("COUNTERSIGN_TEST_POSTGRES") or os.environ.get("DATABASE_URL")
    if not database_url:
        pytest.skip("COUNTERSIGN_TEST_POSTGRES or DATABASE_URL is not configured")

    from langgraph.checkpoint.postgres import PostgresSaver

    thread_id = f"postgres-refund-{uuid4().hex}"
    request = build_refund_request(
        request_id=f"apr_{uuid4().hex}",
        thread_id=thread_id,
        order_id="ord_postgres",
        amount_usd=129,
    )
    config = {"configurable": {"thread_id": thread_id}}

    with PostgresSaver.from_conn_string(database_url) as first_checkpointer:
        first_checkpointer.setup()
        first_graph = build_refund_graph(first_checkpointer)
        paused = first_graph.invoke({"approval_request": request}, config=config)
        assert paused["__interrupt__"][0].value["id"] == request["id"]

    with PostgresSaver.from_conn_string(database_url) as reopened_checkpointer:
        reopened_graph = build_refund_graph(reopened_checkpointer)
        completed = reopened_graph.invoke(
            Command(
                resume=[{
                    "type": "edit",
                    "args": {
                        "action": "issue_refund",
                        "args": {"order_id": "ord_postgres", "amount_usd": 99},
                    },
                }]
            ),
            config=config,
        )
    assert completed["decision"] == "approved"
    assert completed["refunded_amount_usd"] == 99
