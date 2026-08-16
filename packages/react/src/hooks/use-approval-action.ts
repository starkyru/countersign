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

  useEffect(() => {
    // A submission in flight across a request change no longer describes what
    // the caller is looking at, so retire it and clear the state it owned.
    ticket.current += 1;
    setPending(false);
    setError(null);
    return () => { ticket.current += 1; };
    // Deliberately not keyed on `store`: callers construct equivalent stores
    // inline, and treating a new identity as a new request would retire a
    // submission that is still in flight.
  }, [requestId]);

  const submit = useCallback(
    async (decision: ApprovalDecision) => {
      const current = ++ticket.current;
      setPending(true);
      try {
        const record = await store.decide(requestId, decision);
        if (current === ticket.current) setError(null);
        return record;
      } catch (caught) {
        const nextError = caught instanceof Error ? caught : new Error("Unable to submit approval decision");
        if (current === ticket.current) setError(nextError);
        throw nextError;
      } finally {
        if (current === ticket.current) setPending(false);
      }
    },
    [requestId, store],
  );

  return { pending, error, submit };
}
