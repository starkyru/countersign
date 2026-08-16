"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createValidatedEditDecision } from "../edit-validation";
import { useApprovalAction } from "../hooks/use-approval-action";
import type { ApprovalDecision, ApprovalRecord, ApprovalStore, AuditEvent } from "../types";
import { ActionDiff } from "./action-diff";
import { AuditTimeline } from "./audit-timeline";
import { formatRelativeTime, formatTimestamp, requestTitle, statusLabel, titleCase } from "./format";
import { CheckIcon, ChevronIcon, ClockIcon, CloseIcon, EditIcon, MessageIcon, ShieldIcon } from "./icons";
import { SchemaEditForm } from "./schema-edit-form";

type Composer = "edit" | "reject" | "respond" | null;

export interface ApprovalCardProps {
  record: ApprovalRecord;
  store: ApprovalStore;
  showAudit?: boolean;
  className?: string;
  defaultComposer?: Exclude<Composer, null>;
  onRecordChange?(record: ApprovalRecord): void | Promise<void>;
}

function previousArgs(record: ApprovalRecord): Record<string, unknown> {
  const value = record.context?.display?.previous_args;
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sensitivePaths(record: ApprovalRecord): string[] {
  const value = record.context?.display?.sensitive_paths;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function RiskBadge({ risk = "low" }: { risk?: "low" | "medium" | "high" | "critical" }) {
  return <span className={`cs-risk cs-risk--${risk}`}><ShieldIcon /> {titleCase(risk)} risk</span>;
}

/** Complete review surface for one approval, including all Agent Inbox parity actions. */
export function ApprovalCard({ record: recordProp, store, showAudit = true, className, defaultComposer, onRecordChange }: ApprovalCardProps) {
  const [record, setRecord] = useState(recordProp);
  const [composer, setComposer] = useState<Composer>(defaultComposer ?? null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(showAudit);
  const [auditError, setAuditError] = useState<Error | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { submit, pending, error } = useApprovalAction(store, record.id);

  useEffect(() => {
    setRecord(recordProp);
  }, [recordProp]);

  useEffect(() => {
    setComposer(defaultComposer ?? null);
    setReason("");
    setMessage("");
    setSuccess(null);
  }, [defaultComposer, recordProp.id]);

  // Only the newest audit request may write state. Without this ticket a slow
  // mount load can resolve after the post-decision load and overwrite the fresh
  // history, permanently dropping the decision the reviewer just recorded.
  const auditTicket = useRef(0);

  const loadAudit = async () => {
    if (!showAudit) return;
    const ticket = ++auditTicket.current;
    setAuditLoading(true);
    try {
      const next = await store.audit(record.id);
      if (ticket !== auditTicket.current) return;
      setEvents(next);
      setAuditError(null);
    } catch (caught) {
      if (ticket !== auditTicket.current) return;
      setAuditError(caught instanceof Error ? caught : new Error("Unable to load decision history"));
    } finally {
      if (ticket === auditTicket.current) setAuditLoading(false);
    }
  };

  useEffect(() => {
    void loadAudit();
    // Invalidate the in-flight load when the request changes or the card
    // unmounts, so a late resolution cannot write state for a stale record.
    return () => { auditTicket.current += 1; };
  }, [record.id, showAudit, store]);

  // Bumped whenever the card switches to another request or unmounts. A queue
  // refresh can repoint this card while a decision is in flight, and one card
  // instance is reused across requests.
  const shownRequest = useRef(0);
  useEffect(() => () => { shownRequest.current += 1; }, [record.id]);

  const applyDecision = async (decision: ApprovalDecision, confirmation: string) => {
    const decided = shownRequest.current;
    const next = await submit(decision);
    // Paint the result only if this card still shows the request it was for.
    // The parent is notified either way, because the decision did happen.
    if (decided === shownRequest.current) {
      setRecord(next);
      setComposer(null);
      setSuccess(confirmation);
      await loadAudit();
    }
    await onRecordChange?.(next);
  };

  const sourceRows = useMemo(() => [
    ["Graph", record.source?.graph_id],
    ["Environment", record.source?.environment],
    ["Node", record.source?.node],
    ["Thread", record.source?.thread_id],
    ["Checkpoint", record.source?.checkpoint_id],
  ].filter((row): row is [string, string] => Boolean(row[1])), [record]);

  const requirement = record.approval_requirement;
  const isPending = record.status === "pending";
  const approvalsRemaining = requirement ? Math.max(0, requirement.required_approvals - (record.approval_count ?? 0)) : 0;

  return (
    <article className={["cs-card", className].filter(Boolean).join(" ")} aria-labelledby={`cs-title-${record.id}`}>
      <header className="cs-card__header">
        <div className="cs-card__heading">
          <div className="cs-card__meta-row">
            <RiskBadge risk={record.context?.risk_level} />
            <span className={`cs-status cs-status--${record.status}`}>{statusLabel[record.status]}</span>
          </div>
          <h2 id={`cs-title-${record.id}`}>{requestTitle(record)}</h2>
          {record.description ? <p className="cs-card__description">{record.description}</p> : null}
        </div>
        <div className="cs-card__time">
          <ClockIcon />
          <span title={formatTimestamp(record.created_at)}>{formatRelativeTime(record.created_at)}</span>
        </div>
      </header>

      {record.context?.labels?.length ? (
        <ul className="cs-labels" aria-label="Request labels">
          {record.context.labels.map((label) => <li key={label}>{label}</li>)}
        </ul>
      ) : null}

      {requirement && requirement.required_approvals > 1 ? (
        <div className="cs-approval-progress" role="status">
          <span>{record.approval_count ?? 0} of {requirement.required_approvals} signatures recorded</span>
          <div aria-hidden="true">
            {Array.from({ length: requirement.required_approvals }, (_, index) => (
              <i className={index < (record.approval_count ?? 0) ? "is-complete" : ""} key={index} />
            ))}
          </div>
          {isPending ? <small>{approvalsRemaining} distinct reviewer{approvalsRemaining === 1 ? "" : "s"} still required</small> : null}
        </div>
      ) : null}

      <ActionDiff
        action={record.action_request}
        beforeArgs={previousArgs(record)}
        sensitivePaths={sensitivePaths(record)}
      />

      {sourceRows.length ? (
        <details className="cs-provenance">
          <summary><span>Runtime provenance</span><ChevronIcon /></summary>
          <dl>
            {sourceRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </details>
      ) : null}

      {error ? <p className="cs-alert" role="alert">Decision wasn’t recorded. {error.message}</p> : null}
      {success ? <p className="cs-success" role="status"><CheckIcon /> {success}</p> : null}

      {isPending ? (
        <section className="cs-review" aria-label="Review actions">
          <div className="cs-review__actions">
            {record.config.allow_accept ? (
              <button className="cs-button cs-button--primary" disabled={pending} onClick={() => void applyDecision({ type: "approve" }, "Approval recorded.")} type="button">
                <CheckIcon /> {pending && !composer ? "Recording…" : "Approve action"}
              </button>
            ) : null}
            {record.config.allow_edit ? (
              <button className={`cs-button cs-button--secondary ${composer === "edit" ? "is-active" : ""}`} disabled={pending} onClick={() => setComposer(composer === "edit" ? null : "edit")} type="button">
                <EditIcon /> Edit fields
              </button>
            ) : null}
            {record.config.allow_respond ? (
              <button className={`cs-button cs-button--ghost ${composer === "respond" ? "is-active" : ""}`} disabled={pending} onClick={() => setComposer(composer === "respond" ? null : "respond")} type="button">
                <MessageIcon /> Respond
              </button>
            ) : null}
            {record.config.allow_ignore ? (
              <button className={`cs-button cs-button--danger-ghost ${composer === "reject" ? "is-active" : ""}`} disabled={pending} onClick={() => setComposer(composer === "reject" ? null : "reject")} type="button">
                <CloseIcon /> Reject
              </button>
            ) : null}
          </div>

          <div className={`cs-composer ${composer ? "is-open" : ""}`}>
            <div>
              {composer === "edit" ? (
                <SchemaEditForm
                  onCancel={() => setComposer(null)}
                  onSubmit={(args) => applyDecision(createValidatedEditDecision(record, args), "Edited action approved and recorded.")}
                  pending={pending}
                  record={record}
                />
              ) : null}
              {composer === "reject" ? (
                <form className="cs-message-form" onSubmit={(event) => { event.preventDefault(); void applyDecision({ type: "reject", ...(reason.trim() ? { reason: reason.trim() } : {}) }, "Rejection recorded. The action will not run."); }}>
                  <label htmlFor={`cs-reason-${record.id}`}>Why should this action stop?</label>
                  <textarea id={`cs-reason-${record.id}`} onChange={(event) => setReason(event.target.value)} placeholder="Give the agent or next reviewer useful context" rows={3} value={reason} />
                  <div><button className="cs-button cs-button--ghost" onClick={() => setComposer(null)} type="button">Keep reviewing</button><button className="cs-button cs-button--danger" disabled={pending} type="submit"><CloseIcon /> {pending ? "Recording rejection…" : "Reject action"}</button></div>
                </form>
              ) : null}
              {composer === "respond" ? (
                <form className="cs-message-form" onSubmit={(event) => { event.preventDefault(); if (message.trim()) void applyDecision({ type: "respond", message: message.trim() }, "Response sent to the agent."); }}>
                  <label htmlFor={`cs-response-${record.id}`}>Response to the agent</label>
                  <textarea id={`cs-response-${record.id}`} onChange={(event) => setMessage(event.target.value)} placeholder="Ask for clarification or provide missing context" required rows={3} value={message} />
                  <div><button className="cs-button cs-button--ghost" onClick={() => setComposer(null)} type="button">Keep reviewing</button><button className="cs-button cs-button--primary" disabled={pending || !message.trim()} type="submit"><MessageIcon /> {pending ? "Sending response…" : "Send response"}</button></div>
                </form>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <div className={`cs-resolution cs-resolution--${record.status}`}>
          <strong>{statusLabel[record.status]}</strong>
          {record.resolved_at ? <span>{formatTimestamp(record.resolved_at)}</span> : null}
          {record.decision?.type === "reject" && record.decision.reason ? <p>{record.decision.reason}</p> : null}
          {record.decision?.type === "respond" ? <p>{record.decision.message}</p> : null}
        </div>
      )}

      {showAudit ? <AuditTimeline error={auditError} events={events} loading={auditLoading} /> : null}
    </article>
  );
}
