"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ApprovalQueueFilter, ApprovalRecord, ApprovalStatus, ApprovalStore } from "../types";

export interface UseApprovalQueueOptions {
  store: ApprovalStore;
  status?: ApprovalStatus;
  filters?: ApprovalQueueFilter;
  pollIntervalMs?: number;
}

export interface ApprovalQueueState {
  records: ApprovalRecord[];
  loading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
}

/** Subscribe a React surface to a queue without assuming any transport. */
export function useApprovalQueue({
  store,
  status,
  filters,
  pollIntervalMs,
}: UseApprovalQueueOptions): ApprovalQueueState {
  const [records, setRecords] = useState<ApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const filterStatus = status ?? filters?.status;
  const graphId = filters?.graph_id;
  const environment = filters?.environment;
  const action = filters?.action;
  const olderThanSeconds = filters?.older_than_seconds;

  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Cancel the request this one supersedes: without it a slow poll or a
    // stale filter can resolve last and overwrite the current queue, and
    // requests outlive unmount.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      const next = await store.list({
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(graphId ? { graph_id: graphId } : {}),
        ...(environment ? { environment } : {}),
        ...(action ? { action } : {}),
        ...(olderThanSeconds !== undefined ? { older_than_seconds: olderThanSeconds } : {}),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRecords(next);
      setError(null);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught : new Error("Unable to load approval requests"));
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, [action, environment, filterStatus, graphId, olderThanSeconds, store]);

  useEffect(() => {
    void refresh();
    if (!pollIntervalMs) {
      return () => inFlight.current?.abort();
    }
    const interval = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => {
      window.clearInterval(interval);
      inFlight.current?.abort();
    };
  }, [pollIntervalMs, refresh]);

  return { records, loading, error, refresh };
}
