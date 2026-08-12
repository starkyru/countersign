"""LangGraph-native approval decorator and resume helpers."""

from __future__ import annotations

import inspect
from collections.abc import Callable, Mapping
from functools import wraps
from typing import Any, ParamSpec, TypeVar, cast, overload

from langgraph.types import Command, interrupt

from .models import (
    ActionRequest,
    ApprovalContext,
    ApprovalDecision,
    ApprovalRequest,
    HumanInterruptConfig,
    InterruptSource,
    decision_from_agent_inbox,
    decision_to_agent_inbox,
)

P = ParamSpec("P")
R = TypeVar("R")


class ApprovalRejected(RuntimeError):
    """Raised when an approval-wrapped action must not execute."""

    def __init__(self, decision: ApprovalDecision) -> None:
        self.decision = decision
        message = decision.reason or decision.message or "Action was not approved"
        super().__init__(message)


def build_approval_request(
    *,
    action: str,
    args: Mapping[str, Any],
    description: str | None = None,
    config: HumanInterruptConfig | None = None,
    request_id: str | None = None,
    source: InterruptSource | None = None,
    context: ApprovalContext | None = None,
) -> ApprovalRequest:
    """Build a JSON-safe v0 request without assuming a particular framework."""
    return ApprovalRequest(
        schema_version="countersign/v0",
        id=request_id,
        action_request=ActionRequest(action=action, args=dict(args)),
        config=config or HumanInterruptConfig(),
        description=description,
        source=source,
        context=context,
    )


def resume_command(decision: ApprovalDecision, request: ApprovalRequest) -> Command[Any]:
    """Map a console decision to the `Command(resume=...)` LangGraph expects."""
    response = decision_to_agent_inbox(decision, request)
    return Command(resume=[item.model_dump(mode="json") for item in response])


def _call_args(
    function: Callable[..., Any], args: tuple[Any, ...], kwargs: Mapping[str, Any]
) -> dict[str, Any]:
    bound = inspect.signature(function).bind(*args, **kwargs)
    bound.apply_defaults()
    return {name: value for name, value in bound.arguments.items() if name not in {"self", "cls"}}


@overload
def require_approval(function: Callable[P, R]) -> Callable[P, R]: ...


@overload
def require_approval(
    function: None = None,
    *,
    action: str | None = None,
    description: str | None = None,
    config: HumanInterruptConfig | None = None,
    request_id: str | None = None,
    source: InterruptSource | None = None,
    context: ApprovalContext | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def require_approval(
    function: Callable[P, R] | None = None,
    *,
    action: str | None = None,
    description: str | None = None,
    config: HumanInterruptConfig | None = None,
    request_id: str | None = None,
    source: InterruptSource | None = None,
    context: ApprovalContext | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]] | Callable[P, R]:
    """Pause a LangGraph node/tool until a reviewer approves its call.

    The request ID is intentionally opt-in. A value generated inside an
    interrupted node would change when LangGraph replays that node on resume;
    callers should supply a stable ID from state when they need one.
    """

    def decorate(target: Callable[P, R]) -> Callable[P, R]:
        @wraps(target)
        def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
            request = build_approval_request(
                action=action or target.__name__,
                args=_call_args(target, args, kwargs),
                description=description,
                config=config,
                request_id=request_id,
                source=source,
                context=context,
            )
            raw_response = interrupt(request.model_dump(mode="json", exclude_none=True))
            if not isinstance(raw_response, list):
                raise ValueError("Expected an Agent Inbox-compatible response list")
            decision = decision_from_agent_inbox(cast(list[dict[str, Any]], raw_response))
            if decision.type == "reject":
                raise ApprovalRejected(decision)
            if decision.type == "respond":
                raise ApprovalRejected(decision)
            if decision.type == "edit":
                edited = dict(decision.args or {})
                call_values = _call_args(target, args, kwargs)
                call_values.update(edited)
                editable_target = cast(Callable[..., R], target)
                return editable_target(**call_values)
            return target(*args, **kwargs)

        return wrapped

    if function is not None:
        return decorate(function)
    return decorate
