"""Typed Countersign v0 models and Agent Inbox compatibility adapters."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ActionRequest(BaseModel):
    """The action a graph wants a human to review (Agent Inbox-compatible)."""

    model_config = ConfigDict(extra="forbid")

    action: str = Field(min_length=1)
    args: dict[str, Any]


class HumanInterruptConfig(BaseModel):
    """Controls exposed to a reviewer, preserved from Agent Inbox."""

    model_config = ConfigDict(extra="forbid")

    allow_ignore: bool = True
    allow_respond: bool = True
    allow_edit: bool = True
    allow_accept: bool = True


class InterruptSource(BaseModel):
    """Execution provenance available from an agent runtime."""

    model_config = ConfigDict(extra="forbid")

    framework: str = Field(min_length=1)
    thread_id: str = Field(min_length=1)
    graph_id: str | None = None
    environment: str | None = None
    checkpoint_id: str | None = None
    checkpoint_ns: str | None = None
    run_id: str | None = None
    node: str | None = None
    interrupt_id: str | None = None


class ApprovalContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    risk_level: Literal["low", "medium", "high", "critical"] | None = None
    labels: list[str] = Field(default_factory=list)
    display: dict[str, Any] = Field(default_factory=dict)
    edit_schema: dict[str, Any] | None = None


ReviewerRole = Literal["admin", "approver", "viewer"]
TimeoutAction = Literal["reject", "approve", "keep_waiting"]
NotificationChannel = Literal["slack", "email"]


class NotificationTarget(BaseModel):
    """A policy-captured destination; addresses are provider-specific."""

    model_config = ConfigDict(extra="forbid")

    channel: NotificationChannel
    address: str = Field(min_length=1)


class EscalationStep(BaseModel):
    """A notification fan-out due after a request has waited this long."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    after_seconds: int = Field(ge=1)
    targets: list[NotificationTarget] = Field(min_length=1)


def default_approver_roles() -> list[ReviewerRole]:
    return ["approver", "admin"]


class ApprovalRequirement(BaseModel):
    """Routing result captured with a request before it enters the queue."""

    model_config = ConfigDict(extra="forbid")

    policy_id: str | None = None
    required_approvals: int = Field(default=1, ge=1, le=10)
    allowed_roles: list[ReviewerRole] = Field(default_factory=default_approver_roles)
    timeout_seconds: int | None = Field(default=None, ge=1)
    timeout_action: TimeoutAction = "reject"
    notification_targets: list[NotificationTarget] = Field(default_factory=list)
    escalation_steps: list[EscalationStep] = Field(default_factory=list)


class ApprovalRequest(BaseModel):
    """Countersign v0 request; every Agent Inbox HumanInterrupt validates here."""

    model_config = ConfigDict(extra="allow")

    action_request: ActionRequest
    config: HumanInterruptConfig
    description: str | None = None
    schema_version: Literal["countersign/v0"] | None = None
    id: str | None = Field(default=None, min_length=1)
    organization_id: str | None = Field(default=None, min_length=1)
    created_at: datetime | None = None
    expires_at: datetime | None = None
    source: InterruptSource | None = None
    context: ApprovalContext | None = None
    approval_requirement: ApprovalRequirement | None = None


class AgentInboxResponse(BaseModel):
    """The exact value Agent Inbox supplies as an interrupt resume payload."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["accept", "ignore", "response", "edit"]
    args: ActionRequest | str | None

    @field_validator("args")
    @classmethod
    def validate_args_for_type(cls, value: ActionRequest | str | None, info: Any) -> ActionRequest | str | None:
        response_type = info.data.get("type")
        if response_type in {"accept", "edit"} and not isinstance(value, ActionRequest):
            raise ValueError(f"{response_type} responses require an ActionRequest")
        if response_type == "response" and not isinstance(value, str):
            raise ValueError("response requires a string message")
        if response_type == "ignore" and value is not None:
            raise ValueError("ignore requires null args")
        return value


class ApprovalDecision(BaseModel):
    """Framework-neutral decision exposed by Countersign's UI and SDK."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["approve", "reject", "edit", "respond"]
    args: dict[str, Any] | None = None
    message: str | None = None
    reason: str | None = None

    @field_validator("args")
    @classmethod
    def validate_edit_args(cls, value: dict[str, Any] | None, info: Any) -> dict[str, Any] | None:
        if info.data.get("type") == "edit" and value is None:
            raise ValueError("edit decisions require replacement args")
        return value


ApprovalStatus = Literal["pending", "approved", "rejected", "responded", "expired"]


class ApprovalRecord(ApprovalRequest):
    """A request stored in a reviewer queue."""

    id: str = Field(min_length=1)
    status: ApprovalStatus = "pending"
    created_at: datetime
    decision: ApprovalDecision | None = None
    resolved_at: datetime | None = None
    approval_count: int = Field(default=0, ge=0)
    approver_ids: list[str] = Field(default_factory=list)


class AuditEvent(BaseModel):
    """Append-only event in an approval request's review history."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    request_id: str = Field(min_length=1)
    type: Literal[
        "requested",
        "approved",
        "rejected",
        "edited",
        "responded",
        "expired",
        "execution_resumed",
        "execution_completed",
        "execution_failed",
        "execution_halted",
        "notification_sent",
        "notification_failed",
        "escalated",
    ]
    created_at: datetime
    actor: dict[str, str] | None = None
    decision: ApprovalDecision | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    previous_event_hash: str | None = None
    event_hash: str | None = None


def decision_from_agent_inbox(
    response: list[AgentInboxResponse] | list[dict[str, Any]],
) -> ApprovalDecision:
    """Translate Agent Inbox's one-response list into a Countersign decision."""
    if len(response) != 1:
        raise ValueError("Expected exactly one Agent Inbox response")
    item = AgentInboxResponse.model_validate(response[0])
    if item.type == "accept":
        return ApprovalDecision(type="approve")
    if item.type == "ignore":
        return ApprovalDecision(type="reject")
    if item.type == "response":
        return ApprovalDecision(type="respond", message=str(item.args))
    assert isinstance(item.args, ActionRequest)
    return ApprovalDecision(type="edit", args=item.args.args)


def decision_to_agent_inbox(
    decision: ApprovalDecision,
    request: ApprovalRequest,
) -> list[AgentInboxResponse]:
    """Produce the JSON-serializable Agent Inbox resume value for a decision."""
    if decision.type == "approve":
        return [AgentInboxResponse(type="accept", args=request.action_request)]
    if decision.type == "reject":
        return [AgentInboxResponse(type="ignore", args=None)]
    if decision.type == "respond":
        if not decision.message:
            raise ValueError("respond decisions require a message")
        return [AgentInboxResponse(type="response", args=decision.message)]
    if decision.args is None:
        raise ValueError("edit decisions require replacement args")
    return [
        AgentInboxResponse(
            type="edit",
            args=ActionRequest(action=request.action_request.action, args=decision.args),
        )
    ]
