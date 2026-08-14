import "./styles.css";

export type {
  ApprovalRequest,
  ApprovalDecision,
  ApprovalStatus,
  ProposedAction,
  InterruptSource,
  HumanInterruptConfig,
  ApprovalContext,
  JsonSchema,
  ApprovalRequirement,
  ApprovalRecord,
  ApprovalStore,
  ApprovalSubscriptionEvent,
  ApprovalQueueFilter,
  AuditEvent,
  AuditEventType,
  ReviewerRole,
  NotificationTarget,
  EscalationStep,
} from "./types";
export {
  ApprovalEditValidationError,
  createValidatedEditDecision,
  validateApprovalEdit,
} from "./edit-validation";
export type {
  EditValidationIssue,
  EditValidationResult,
} from "./edit-validation";
export { diffActionArgs, diffProposedAction } from "./action-diff";
export type {
  ActionDiffKind,
  ActionDiffOptions,
  ActionFieldDiff,
} from "./action-diff";
export { InMemoryApprovalStore, toApprovalRecord } from "./store";
export { HttpApprovalStore } from "./http-store";
export { ApprovalEventStreamError } from "./sse";
export { useApprovalAction } from "./hooks/use-approval-action";
export { useApprovalQueue } from "./hooks/use-approval-queue";
export { createDemoStore, demoApprovals } from "./mock";
export { ActionDiff } from "./components/action-diff";
export type { ActionDiffProps } from "./components/action-diff";
export { AuditTimeline } from "./components/audit-timeline";
export type { AuditTimelineProps } from "./components/audit-timeline";
export { SchemaEditForm } from "./components/schema-edit-form";
export type { SchemaEditFormProps } from "./components/schema-edit-form";
export { ApprovalCard } from "./components/approval-card";
export type { ApprovalCardProps } from "./components/approval-card";
export { ApprovalInbox } from "./components/approval-inbox";
export type { ApprovalInboxProps } from "./components/approval-inbox";
