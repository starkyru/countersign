import { InMemoryApprovalStore, toApprovalRecord } from "./store";
import type { ApprovalRecord } from "./types";

export const demoApprovals: ApprovalRecord[] = [
  toApprovalRecord(
    {
      schema_version: "countersign/v0",
      action_request: {
        action: "issue_refund",
        args: { order_id: "ord_4821", amount_usd: 129, reason: "duplicate_charge", notify_customer: true },
      },
      config: { allow_accept: true, allow_edit: true, allow_ignore: true, allow_respond: true },
      description: "Customer reports a duplicate charge. Refund the second capture.",
      source: { framework: "langgraph", graph_id: "refund-agent", environment: "production", thread_id: "refund-4821", node: "review_refund", checkpoint_id: "1f03c8b9" },
      context: {
        risk_level: "medium",
        labels: ["refund", "payments"],
        display: { title: "Refund duplicate charge", previous_args: { order_id: "ord_4821", amount_usd: 0, reason: "pending_review", notify_customer: false } },
        edit_schema: {
          type: "object",
          properties: {
            order_id: { type: "string", title: "Order ID", description: "The immutable commerce order reference." },
            amount_usd: { type: "number", title: "Refund amount (USD)", minimum: 1, maximum: 500 },
            reason: { type: "string", title: "Refund reason", enum: ["duplicate_charge", "service_issue", "fraud"] },
            notify_customer: { type: "boolean", title: "Notify customer" },
          },
          required: ["order_id", "amount_usd", "reason", "notify_customer"],
          additionalProperties: false,
        },
      },
      approval_requirement: { policy_id: "production-refunds", required_approvals: 2, allowed_roles: ["approver", "admin"], timeout_seconds: 1800, timeout_action: "reject" },
    },
    { id: "apr_refund_4821", createdAt: "2026-08-11T13:42:00Z" },
  ),
  toApprovalRecord(
    {
      schema_version: "countersign/v0",
      action_request: {
        action: "send_email",
        args: { to: "maya.chen@example.com", subject: "Your renewal is ready", tone: "concise" },
      },
      config: { allow_accept: true, allow_edit: true, allow_ignore: true, allow_respond: true },
      description: "The renewal assistant prepared a customer-facing email.",
      source: { framework: "langgraph", graph_id: "renewal-agent", environment: "staging", thread_id: "renewal-1337", node: "send_email" },
      context: {
        risk_level: "low",
        labels: ["email", "customer-success"],
        display: { title: "Send renewal email", sensitive_paths: ["/to"] },
        edit_schema: {
          type: "object",
          properties: {
            to: { type: "string", format: "email", title: "Recipient" },
            subject: { type: "string", title: "Subject" },
            tone: { type: "string", enum: ["concise", "warm", "formal"], title: "Tone" },
          },
          required: ["to", "subject", "tone"],
          additionalProperties: false,
        },
      },
    },
    { id: "apr_email_1337", createdAt: "2026-08-11T13:28:00Z" },
  ),
  toApprovalRecord(
    {
      schema_version: "countersign/v0",
      action_request: {
        action: "rotate_production_key",
        args: { service: "billing-api", region: "us-east-1", revoke_previous: true },
      },
      config: { allow_accept: true, allow_edit: false, allow_ignore: true, allow_respond: true },
      description: "The security agent detected an exposed credential and proposes an immediate rotation.",
      source: { framework: "langgraph", graph_id: "security-operator", environment: "production", thread_id: "incident-229", node: "rotate_credential" },
      context: { risk_level: "critical", labels: ["security", "incident"] },
    },
    { id: "apr_key_229", createdAt: "2026-08-11T12:57:00Z" },
  ),
  toApprovalRecord(
    {
      schema_version: "countersign/v0",
      action_request: {
        action: "update_crm_record",
        args: { account_id: "acct_091", lifecycle_stage: "contract_sent", deal_value_usd: 24000 },
      },
      config: { allow_accept: true, allow_edit: true, allow_ignore: true, allow_respond: false },
      description: "Update the account after the sales agent generated a countersigned agreement.",
      source: { framework: "langgraph", graph_id: "revenue-agent", environment: "production", thread_id: "deal-091", node: "sync_crm" },
      context: { risk_level: "high", labels: ["crm", "revenue"], display: { title: "Advance enterprise deal" } },
    },
    { id: "apr_crm_091", createdAt: "2026-08-11T11:18:00Z" },
  ),
];

export function createDemoStore(): InMemoryApprovalStore {
  return new InMemoryApprovalStore(demoApprovals);
}
