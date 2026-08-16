"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ApprovalStore, AuditEvent } from "../types";

export interface AuditEventsState {
  events: AuditEvent[];
  loading: boolean;
  error: Error | null;
  reload(): Promise<void>;
}

/** Load one request's decision history, keeping only the newest load's result. */
export function useAuditEvents(
  store: ApprovalStore,
  requestId: string,
  enabled: boolean,
): AuditEventsState {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  // Only the newest load may write state. Without this a slow mount load can
  // resolve after the post-decision load and overwrite the fresh history,
  // permanently dropping the decision the reviewer just recorded.
  const inFlight = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    // Cancel the load this one supersedes. Its result is discarded either way,
    // so leaving it in flight only holds a connection nothing will read.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      const next = await store.audit(requestId, controller.signal);
      if (controller.signal.aborted) return;
      setEvents(next);
      setError(null);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught : new Error("Unable to load decision history"));
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, [enabled, requestId, store]);

  useEffect(() => {
    void reload();
    // Cancel the in-flight load when the request changes or the caller
    // unmounts, so a late resolution cannot write state for a stale record.
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [reload]);

  return { events, loading, error, reload };
}
