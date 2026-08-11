import type { ApprovalRecord, ApprovalStatus, AuditEventType } from "../types";

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatValue(value: unknown): string {
  if (value === undefined) return "Not set";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
  }
  if (typeof value === "boolean") return value ? "True" : "False";
  return JSON.stringify(value, null, 2);
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export const statusLabel: Record<ApprovalStatus, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  responded: "Response sent",
  expired: "Expired",
};

export const auditLabel: Record<AuditEventType, string> = {
  requested: "Approval requested",
  approved: "Action approved",
  rejected: "Action rejected",
  edited: "Action edited and approved",
  responded: "Response sent to agent",
  expired: "Review window expired",
  execution_resumed: "Agent resumed",
  execution_completed: "Execution completed",
  execution_failed: "Execution failed",
  execution_halted: "Execution halted",
  notification_sent: "Notification sent",
  notification_failed: "Notification failed",
  escalated: "Review escalated",
};

export function requestTitle(record: ApprovalRecord): string {
  const displayTitle = record.context?.display?.title;
  return typeof displayTitle === "string" && displayTitle.trim()
    ? displayTitle
    : titleCase(record.action_request.action);
}
