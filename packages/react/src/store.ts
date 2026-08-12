import { ApprovalEditValidationError, validateApprovalEdit } from "./edit-validation";
import type {
  ApprovalDecision,
  ApprovalRecord,
  ApprovalRequest,
  ApprovalQueueFilter,
  ApprovalStatus,
  ApprovalStore,
  AuditEvent,
} from "./types";

const terminalStatus: Record<ApprovalDecision["type"], ApprovalStatus> = {
  approve: "approved",
  reject: "rejected",
  edit: "approved",
  respond: "responded",
};

function now(): string {
  return new Date().toISOString();
}

function eventType(decision: ApprovalDecision): AuditEvent["type"] {
  switch (decision.type) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "edit":
      return "edited";
    case "respond":
      return "responded";
  }
}

function ensureDecisionIsAllowed(record: ApprovalRecord, decision: ApprovalDecision): void {
  const allowed = {
    approve: record.config.allow_accept,
    reject: record.config.allow_ignore,
    edit: record.config.allow_edit,
    respond: record.config.allow_respond,
  }[decision.type];
  if (!allowed) {
    throw new Error(`The graph did not allow a ${decision.type} decision for this request`);
  }
  if (decision.type === "edit") {
    const result = validateApprovalEdit(record, decision.args);
    if (!result.valid) {
      throw new ApprovalEditValidationError(result.errors);
    }
  }
}

/**
 * Lightweight browser-safe store for demos, stories, and local integration.
 * It intentionally mirrors the async interface a real server adapter uses.
 */
export class InMemoryApprovalStore implements ApprovalStore {
  private readonly records = new Map<string, ApprovalRecord>();
  private readonly events = new Map<string, AuditEvent[]>();
  private nextEventId = 1;

  constructor(initial: ApprovalRecord[] = []) {
    for (const record of initial) {
      this.records.set(record.id, structuredClone(record));
      this.events.set(record.id, [
        {
          id: `evt_${this.nextEventId++}`,
          request_id: record.id,
          type: "requested",
          created_at: record.created_at,
        },
      ]);
    }
  }

  async list(input: ApprovalQueueFilter & { signal?: AbortSignal } = {}): Promise<ApprovalRecord[]> {
    input.signal?.throwIfAborted();
    return [...this.records.values()]
      .filter((record) => {
        const source = record.source;
        const ageSeconds = (Date.now() - Date.parse(record.created_at)) / 1_000;
        return (
          (!input.status || record.status === input.status) &&
          (!input.graph_id || source?.graph_id === input.graph_id) &&
          (!input.environment || source?.environment === input.environment) &&
          (!input.action || record.action_request.action === input.action) &&
          (!input.older_than_seconds || ageSeconds >= input.older_than_seconds)
        );
      })
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((record) => structuredClone(record));
  }

  async get(id: string, signal?: AbortSignal): Promise<ApprovalRecord | null> {
    signal?.throwIfAborted();
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async decide(id: string, decision: ApprovalDecision, signal?: AbortSignal): Promise<ApprovalRecord> {
    signal?.throwIfAborted();
    const current = this.records.get(id);
    if (!current) {
      throw new Error(`Approval request ${id} was not found`);
    }
    if (current.status !== "pending") {
      throw new Error(`Approval request ${id} has already been ${current.status}`);
    }
    ensureDecisionIsAllowed(current, decision);

    const resolvedAt = now();
    const resolved: ApprovalRecord = {
      ...current,
      status: terminalStatus[decision.type],
      decision: structuredClone(decision),
      resolved_at: resolvedAt,
    };
    this.records.set(id, resolved);
    const priorEvents = this.events.get(id) ?? [];
    this.events.set(id, [
      ...priorEvents,
      {
        id: `evt_${this.nextEventId++}`,
        request_id: id,
        type: eventType(decision),
        created_at: resolvedAt,
        decision: structuredClone(decision),
      },
    ]);
    return structuredClone(resolved);
  }

  async audit(id: string, signal?: AbortSignal): Promise<AuditEvent[]> {
    signal?.throwIfAborted();
    return structuredClone(this.events.get(id) ?? []);
  }
}

export function toApprovalRecord(
  request: ApprovalRequest,
  options: { id: string; createdAt?: string; status?: ApprovalStatus },
): ApprovalRecord {
  return {
    ...request,
    id: options.id,
    created_at: options.createdAt ?? request.created_at ?? now(),
    status: options.status ?? request.status ?? "pending",
  };
}
