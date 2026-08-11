"use client";

import { useEffect, useMemo, useState } from "react";

import { useApprovalQueue } from "../hooks/use-approval-queue";
import type { ApprovalQueueFilter, ApprovalRecord, ApprovalStatus, ApprovalStore } from "../types";
import { ApprovalCard } from "./approval-card";
import { formatRelativeTime, requestTitle, statusLabel, titleCase } from "./format";
import { ArrowIcon, InboxIcon, RefreshIcon, ShieldIcon } from "./icons";

export interface ApprovalInboxProps {
  store: ApprovalStore;
  initialStatus?: ApprovalStatus;
  filters?: ApprovalQueueFilter;
  pollIntervalMs?: number;
  showFilters?: boolean;
  className?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  initialRequestId?: string;
  initialMode?: "edit" | "reject" | "respond";
}

function QueueRow({ record, selected, onSelect }: { record: ApprovalRecord; selected: boolean; onSelect(): void }) {
  return (
    <li>
      <button aria-current={selected ? "true" : undefined} className="cs-queue-row" onClick={onSelect} type="button">
        <span className="cs-queue-row__topline">
          <span className={`cs-queue-row__risk cs-queue-row__risk--${record.context?.risk_level ?? "low"}`}><ShieldIcon /> {record.context?.risk_level ?? "low"}</span>
          <time dateTime={record.created_at}>{formatRelativeTime(record.created_at)}</time>
        </span>
        <strong>{requestTitle(record)}</strong>
        <span className="cs-queue-row__agent">{record.source?.graph_id ?? "Unidentified agent"} <ArrowIcon /> {record.source?.environment ?? "local"}</span>
        <span className="cs-queue-row__footer"><code>{record.action_request.action}</code><em className={`cs-status cs-status--${record.status}`}>{statusLabel[record.status]}</em></span>
      </button>
    </li>
  );
}

/** Responsive fleet inbox with queue filters and a complete review panel. */
export function ApprovalInbox({
  store,
  initialStatus = "pending",
  filters: fixedFilters,
  pollIntervalMs,
  showFilters = true,
  className,
  emptyTitle = "The queue is clear",
  emptyMessage = "New agent actions will appear here when they need a human signature.",
  initialRequestId,
  initialMode,
}: ApprovalInboxProps) {
  const [status, setStatus] = useState<ApprovalStatus | "all">(initialStatus);
  const [graph, setGraph] = useState(fixedFilters?.graph_id ?? "");
  const [environment, setEnvironment] = useState(fixedFilters?.environment ?? "");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialRequestId ?? null);
  const [recentRecord, setRecentRecord] = useState<ApprovalRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(Boolean(initialRequestId));
  const liveFilters = useMemo<ApprovalQueueFilter>(() => ({
    ...fixedFilters,
    ...(graph ? { graph_id: graph } : {}),
    ...(environment ? { environment } : {}),
  }), [environment, fixedFilters, graph]);
  const { records, loading, error, refresh } = useApprovalQueue({
    store,
    status: status === "all" ? undefined : status,
    filters: liveFilters,
    pollIntervalMs,
  });
  const visibleRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return records;
    return records.filter((record) => [requestTitle(record), record.description, record.action_request.action, record.source?.thread_id]
      .some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [records, search]);
  const selected = (recentRecord?.id === selectedId ? recentRecord : null)
    ?? visibleRecords.find((record) => record.id === selectedId)
    ?? visibleRecords[0]
    ?? null;

  useEffect(() => {
    if (!selectedId && visibleRecords[0]) setSelectedId(visibleRecords[0].id);
    if (selectedId && !visibleRecords.some((record) => record.id === selectedId) && recentRecord?.id !== selectedId) {
      setSelectedId(visibleRecords[0]?.id ?? null);
    }
  }, [recentRecord, selectedId, visibleRecords]);

  useEffect(() => {
    if (initialRequestId) {
      setSelectedId(initialRequestId);
      setDetailOpen(true);
    }
  }, [initialRequestId]);

  return (
    <section className={["cs-inbox", detailOpen ? "cs-inbox--detail" : "", className].filter(Boolean).join(" ")}>
      <div className="cs-inbox__queue">
        <header className="cs-inbox__header">
          <div>
            <span className="cs-eyebrow">Human oversight</span>
            <h1>Approval inbox</h1>
          </div>
          <button aria-label="Refresh approval queue" className="cs-icon-button" disabled={loading} onClick={() => void refresh()} type="button"><RefreshIcon className={loading ? "is-spinning" : ""} /></button>
        </header>
        <div className="cs-inbox__count" aria-live="polite">
          <strong>{visibleRecords.length}</strong>
          <span>{status === "all" ? "requests" : status === "pending" ? "waiting for review" : statusLabel[status].toLocaleLowerCase()}</span>
        </div>
        {showFilters ? (
          <div className="cs-filters" aria-label="Approval filters">
            <label className="cs-search"><span className="cs-sr-only">Search approvals</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Search action or thread" type="search" value={search} /></label>
            <div>
              <label><span>Status</span><select onChange={(event) => { setStatus(event.target.value as ApprovalStatus | "all"); setRecentRecord(null); setSelectedId(null); }} value={status}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="responded">Responded</option><option value="expired">Expired</option><option value="all">All statuses</option></select></label>
              <label><span>Environment</span><input onChange={(event) => setEnvironment(event.target.value)} placeholder="All environments" type="text" value={environment} /></label>
              <label><span>Agent</span><input onChange={(event) => setGraph(event.target.value)} placeholder="All agents" type="text" value={graph} /></label>
            </div>
          </div>
        ) : null}
        {error ? <p className="cs-alert" role="alert">The approval queue couldn’t be loaded. {error.message}</p> : null}
        {loading && records.length === 0 ? (
          <div className="cs-queue-skeleton" aria-label="Loading approval queue">{Array.from({ length: 3 }, (_, index) => <i key={index} />)}</div>
        ) : null}
        {!loading && !error && visibleRecords.length === 0 ? (
          <div className="cs-empty-state"><InboxIcon /><h2>{emptyTitle}</h2><p>{emptyMessage}</p></div>
        ) : null}
        <ul className="cs-queue-list">
          {visibleRecords.map((record) => (
            <QueueRow
              key={record.id}
              onSelect={() => { setRecentRecord(null); setSelectedId(record.id); setDetailOpen(true); }}
              record={record}
              selected={record.id === selected?.id}
            />
          ))}
        </ul>
      </div>
      <div className="cs-inbox__detail">
        <button className="cs-back-button" onClick={() => setDetailOpen(false)} type="button"><ArrowIcon /> Back to queue</button>
        {selected ? (
          <ApprovalCard defaultComposer={selected.id === initialRequestId ? initialMode : undefined} onRecordChange={async (next) => { setRecentRecord(next); await refresh(); }} record={selected} store={store} />
        ) : (
          <div className="cs-detail-empty"><ArrowIcon /><p>Select a request to inspect its proposed action and provenance.</p></div>
        )}
      </div>
    </section>
  );
}
