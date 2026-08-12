"use client";

import { useCallback, useState } from "react";

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

  const submit = useCallback(
    async (decision: ApprovalDecision) => {
      setPending(true);
      try {
        const record = await store.decide(requestId, decision);
        setError(null);
        return record;
      } catch (caught) {
        const nextError = caught instanceof Error ? caught : new Error("Unable to submit approval decision");
        setError(nextError);
        throw nextError;
      } finally {
        setPending(false);
      }
    },
    [requestId, store],
  );

  return { pending, error, submit };
}
