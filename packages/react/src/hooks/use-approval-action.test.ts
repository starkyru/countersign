import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import type { ApprovalRecord, ApprovalStore, AuditEvent } from "../types";
import {
  useApprovalAction,
  type ApprovalActionState,
} from "./use-approval-action";

const REQUEST_ID = "apr_action_1";

const approvedRecord: ApprovalRecord = {
  id: REQUEST_ID,
  status: "approved",
  created_at: "2026-08-16T10:00:00Z",
  action_request: { action: "issue_refund", args: { order_id: "ord_1" } },
  config: {
    allow_accept: true,
    allow_edit: false,
    allow_ignore: false,
    allow_respond: false,
  },
  decision: { type: "approve" },
};

/** Hands back decide() promises the test settles in whatever order it chooses. */
class DeferredDecisionStore implements ApprovalStore {
  readonly pendingDecisions: Array<{
    resolve(record: ApprovalRecord): void;
    reject(error: Error): void;
  }> = [];

  async list(): Promise<ApprovalRecord[]> {
    return [];
  }

  async get(): Promise<ApprovalRecord | null> {
    return null;
  }

  decide(): Promise<ApprovalRecord> {
    return new Promise<ApprovalRecord>((resolve, reject) => {
      this.pendingDecisions.push({ resolve, reject });
    });
  }

  async audit(): Promise<AuditEvent[]> {
    return [];
  }
}

function ActionHarness({
  store,
  requestId,
  onState,
}: {
  store: ApprovalStore;
  requestId: string;
  onState(state: ApprovalActionState): void;
}) {
  onState(useApprovalAction(store, requestId));
  return null;
}

describe("useApprovalAction overlapping submissions", () => {
  it("keeps pending until the newest submission settles", async () => {
    const store = new DeferredDecisionStore();
    let state: ApprovalActionState | undefined;
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(ActionHarness, {
          store,
          requestId: REQUEST_ID,
          onState: (next) => {
            state = next;
          },
        }),
      );
    });
    if (!state) throw new Error("Harness never reported state");
    expect(state.pending).toBe(false);

    const submit = state.submit;
    let first: Promise<ApprovalRecord | Error> | undefined;
    let second: Promise<ApprovalRecord | Error> | undefined;
    await act(async () => {
      first = submit({ type: "approve" });
      second = submit({ type: "approve" });
    });
    expect(store.pendingDecisions).toHaveLength(2);
    expect(state.pending).toBe(true);

    const [firstDecision, secondDecision] = store.pendingDecisions;
    if (!firstDecision || !secondDecision) {
      throw new Error("Expected two decide calls");
    }

    // The superseded submission settles first and must not clear pending.
    await act(async () => {
      firstDecision.resolve(approvedRecord);
    });
    expect(state.pending).toBe(true);

    await act(async () => {
      secondDecision.resolve(approvedRecord);
    });
    expect(state.pending).toBe(false);

    await expect(first).resolves.toBe(approvedRecord);
    await expect(second).resolves.toBe(approvedRecord);

    await act(async () => renderer?.unmount());
  });

  it("ignores a superseded submission's failure", async () => {
    const store = new DeferredDecisionStore();
    let state: ApprovalActionState | undefined;
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(ActionHarness, {
          store,
          requestId: REQUEST_ID,
          onState: (next) => {
            state = next;
          },
        }),
      );
    });
    if (!state) throw new Error("Harness never reported state");

    const submit = state.submit;
    let first: Promise<ApprovalRecord | Error> | undefined;
    await act(async () => {
      first = submit({ type: "approve" }).catch((caught: Error) => caught);
      void submit({ type: "approve" }).catch(() => undefined);
    });

    const [firstDecision, secondDecision] = store.pendingDecisions;
    if (!firstDecision || !secondDecision) {
      throw new Error("Expected two decide calls");
    }

    await act(async () => {
      secondDecision.resolve(approvedRecord);
    });
    await act(async () => {
      firstDecision.reject(new Error("Gateway timeout"));
    });

    expect(state.error).toBeNull();
    expect(state.pending).toBe(false);
    // The caller of the superseded submission still sees its own rejection.
    await expect(first).resolves.toEqual(new Error("Gateway timeout"));

    await act(async () => renderer?.unmount());
  });
});
