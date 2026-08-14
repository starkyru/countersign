"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApprovalEventStreamError } from "../sse";
import type {
  ApprovalQueueFilter,
  ApprovalRecord,
  ApprovalStatus,
  ApprovalStore,
} from "../types";

export interface UseApprovalQueueOptions {
  store: ApprovalStore;
  status?: ApprovalStatus;
  filters?: ApprovalQueueFilter;
  /** Polling fallback interval when SSE is unavailable; disabled while SSE is healthy. */
  pollIntervalMs?: number;
  /** Change this value when intentionally replacing the store during a mount. */
  storeKey?: string | number;
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
  storeKey,
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
  const storeRef = useRef({ key: storeKey, value: store });

  useEffect(() => {
    // Store identity is intentionally keyed. This keeps refresh and subscribe
    // on the same committed store when callers construct equivalent stores
    // inline, while a changed key replaces both after commit.
    if (storeRef.current.key !== storeKey) {
      storeRef.current = { key: storeKey, value: store };
    }
  }, [store, storeKey]);

  const refresh = useCallback(async () => {
    // Cancel the request this one supersedes: without it a slow poll or a
    // stale filter can resolve last and overwrite the current queue, and
    // requests outlive unmount.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      const next = await storeRef.current.value.list({
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(graphId ? { graph_id: graphId } : {}),
        ...(environment ? { environment } : {}),
        ...(action ? { action } : {}),
        ...(olderThanSeconds !== undefined
          ? { older_than_seconds: olderThanSeconds }
          : {}),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRecords(next);
      setError(null);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(
          caught instanceof Error
            ? caught
            : new Error("Unable to load approval requests"),
        );
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, [action, environment, filterStatus, graphId, olderThanSeconds]);

  useEffect(() => {
    void refresh();
    let interval: number | undefined;
    const startPolling = () => {
      if (pollIntervalMs && interval === undefined) {
        interval = window.setInterval(() => void refresh(), pollIntervalMs);
      }
    };
    const activeStore = storeRef.current.value;
    const unsubscribe = activeStore.subscribe?.(
      () => void refresh(),
      (streamError) => {
        setError(streamError);
        if (
          streamError instanceof ApprovalEventStreamError &&
          [404, 405].includes(streamError.status)
        ) {
          startPolling();
        }
      },
    );
    if (!unsubscribe) startPolling();
    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      unsubscribe?.();
      inFlight.current?.abort();
    };
  }, [pollIntervalMs, refresh, storeKey]);

  return { records, loading, error, refresh };
}
