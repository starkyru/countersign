"""Countersign: human-in-the-loop approvals for LangGraph agents."""

from .adapters import SelfHostedLangGraphAdapter
from .approval import ApprovalRejected, build_approval_request, require_approval, resume_command
from .models import (
    ActionRequest,
    AgentInboxResponse,
    ApprovalContext,
    ApprovalDecision,
    ApprovalRecord,
    ApprovalRequirement,
    ApprovalRequest,
    ApprovalStatus,
    AuditEvent,
    EscalationStep,
    HumanInterruptConfig,
    InterruptSource,
    NotificationChannel,
    NotificationTarget,
    ReviewerRole,
    decision_from_agent_inbox,
    decision_to_agent_inbox,
)

__all__ = [
    "ActionRequest",
    "AgentInboxResponse",
    "ApprovalContext",
    "ApprovalDecision",
    "ApprovalRecord",
    "ApprovalRejected",
    "ApprovalRequirement",
    "ApprovalRequest",
    "ApprovalStatus",
    "AuditEvent",
    "EscalationStep",
    "HumanInterruptConfig",
    "InterruptSource",
    "NotificationChannel",
    "NotificationTarget",
    "ReviewerRole",
    "SelfHostedLangGraphAdapter",
    "build_approval_request",
    "decision_from_agent_inbox",
    "decision_to_agent_inbox",
    "require_approval",
    "resume_command",
]

__version__ = "0.1.0"
