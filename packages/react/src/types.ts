/** Countersign's UI model for the v0 approval-request wire format. */
export interface ApprovalRequest {
  /** Optional so a plain Agent Inbox HumanInterrupt remains assignable. */
  id?: string;
  organization_id?: string;
  schema_version?: "countersign/v0";
  /** Agent Inbox's `action_request` field, preserved verbatim. */
  action_request: ProposedAction;
  config: HumanInterruptConfig;
  /** Human-readable Markdown-capable summary supplied by the agent author. */
  description?: string;
  status?: ApprovalStatus;
  created_at?: string;
  expires_at?: string;
  /** LangGraph provenance, when the producer can supply it. */
  source?: InterruptSource;
  context?: ApprovalContext;
  approval_requirement?: ApprovalRequirement;
}

export interface ProposedAction {
  action: string;
  args: Record<string, unknown>;
}

export interface InterruptSource {
  framework: string;
  graph_id?: string;
  environment?: string;
  thread_id: string;
  checkpoint_id?: string;
  checkpoint_ns?: string;
  run_id?: string;
  node?: string;
  interrupt_id?: string;
}

export interface HumanInterruptConfig {
  allow_ignore: boolean;
  allow_respond: boolean;
  allow_edit: boolean;
  allow_accept: boolean;
}

export interface ApprovalContext {
  risk_level?: "low" | "medium" | "high" | "critical";
  labels?: string[];
  display?: Record<string, unknown>;
  /** Optional JSON Schema used to validate edit decision arguments. */
  edit_schema?: JsonSchema;
}

/** A JSON Schema document. Kept open so callers can use standard keywords. */
export type JsonSchema = Record<string, unknown>;

export type ReviewerRole = "admin" | "approver" | "viewer";

export interface ApprovalRequirement {
  policy_id?: string;
  required_approvals: number;
  allowed_roles: ReviewerRole[];
  timeout_seconds?: number;
  timeout_action?: "reject" | "approve" | "keep_waiting";
  notification_targets?: NotificationTarget[];
  escalation_steps?: EscalationStep[];
}

export interface NotificationTarget {
  channel: "slack" | "email";
  address: string;
}

export interface EscalationStep {
  id: string;
  after_seconds: number;
  targets: NotificationTarget[];
}

export type ApprovalStatus =
  "pending" | "approved" | "rejected" | "responded" | "expired";

export type ApprovalDecision =
  | { type: "approve" }
  | { type: "reject"; reason?: string }
  | { type: "edit"; args: Record<string, unknown> }
  | { type: "respond"; message: string };

/** A request after it has entered an approval queue. */
export interface ApprovalRecord extends ApprovalRequest {
  id: string;
  status: ApprovalStatus;
  created_at: string;
  decision?: ApprovalDecision;
  resolved_at?: string;
  approval_count?: number;
  approver_ids?: string[];
}

export type AuditEventType =
  | "requested"
  | "approved"
  | "rejected"
  | "edited"
  | "responded"
  | "expired"
  | "execution_resumed"
  | "execution_completed"
  | "execution_failed"
  | "execution_halted"
  | "notification_sent"
  | "notification_failed"
  | "escalated";

export interface AuditEvent {
  id: string;
  request_id: string;
  type: AuditEventType;
  created_at: string;
  actor?: { id: string; name?: string };
  decision?: ApprovalDecision;
  metadata?: Record<string, unknown>;
  previous_event_hash?: string;
  event_hash?: string;
}

export interface ApprovalStore {
  list(
    input?: ApprovalQueueFilter & { signal?: AbortSignal },
  ): Promise<ApprovalRecord[]>;
  get(id: string, signal?: AbortSignal): Promise<ApprovalRecord | null>;
  decide(
    id: string,
    decision: ApprovalDecision,
    signal?: AbortSignal,
  ): Promise<ApprovalRecord>;
  audit(id: string, signal?: AbortSignal): Promise<AuditEvent[]>;
  /** Subscribe to queue/audit changes. The returned cleanup must release all resources. */
  subscribe?(
    listener: (event: ApprovalSubscriptionEvent) => void,
    onError?: (error: Error) => void,
  ): () => void;
}

export interface ApprovalSubscriptionEvent {
  id: string;
  request_id: string;
  type: AuditEventType;
  created_at: string;
}

export interface ApprovalQueueFilter {
  status?: ApprovalStatus;
  graph_id?: string;
  environment?: string;
  action?: string;
  older_than_seconds?: number;
}
