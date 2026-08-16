"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ApprovalDecision, ApprovalRecord, ApprovalStore } from "../types";

export interface ApprovalActionState {
  pending: boolean;
  error: Error | null;
  submit(decision: ApprovalDecision): Promise<ApprovalRecord>;
}

/** Submit one decision while exposing an action-local pending/error state. */
export function useApprovalAction(store: ApprovalStore, requestId: string): ApprovalActionState {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Only the newest submission may write state. Without this ticket a superseded
  // call settling late clears pending while a decision is still in flight, or
  // reports its own failure over the newer call's result.
  const ticket = useRef(0);

  // The newest submission's controller, kept so the next one can cancel it.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    // A submission in flight across a request change no longer describes what
    // the caller is looking at, so retire it and clear the state it owned. It
    // is deliberately not aborted: the reviewer decided the previous request
    // and that decision must still reach the server. Dropping the reference
    // also keeps the next submission from cancelling another request's write.
    ticket.current += 1;
    inFlight.current = null;
    setPending(false);
    setError(null);
    return () => { ticket.current += 1; };
    // Deliberately not keyed on `store`: callers construct equivalent stores
    // inline, and treating a new identity as a new request would retire a
    // submission that is still in flight.
  }, [requestId]);

  const submit = useCallback(
    async (decision: ApprovalDecision) => {
      // Cancel the submission this one supersedes. Its result is discarded
      // either way, so leaving it in flight only holds a connection nothing
      // will read; only a same-request submission is ever cancelled here.
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const current = ++ticket.current;
      setPending(true);
      try {
        const record = await store.decide(requestId, decision, controller.signal);
        if (current === ticket.current) setError(null);
        return record;
      } catch (caught) {
        const nextError = caught instanceof Error ? caught : new Error("Unable to submit approval decision");
        if (current === ticket.current) setError(nextError);
        throw nextError;
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
        if (current === ticket.current) setPending(false);
      }
    },
    [requestId, store],
  );

  return { pending, error, submit };
}
