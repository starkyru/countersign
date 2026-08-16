import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import type {
  ApprovalDecision,
  ApprovalRecord,
  ApprovalStore,
  AuditEvent,
} from "../types";
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

  readonly decisionSignals: Array<AbortSignal | undefined> = [];

  async list(): Promise<ApprovalRecord[]> {
    return [];
  }

  async get(): Promise<ApprovalRecord | null> {
    return null;
  }

  decide(
    _id: string,
    _decision: ApprovalDecision,
    signal?: AbortSignal,
  ): Promise<ApprovalRecord> {
    this.decisionSignals.push(signal);
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

describe("useApprovalAction request cancellation", () => {
  async function renderHarness(store: ApprovalStore, requestId: string) {
    const seen: { state?: ApprovalActionState } = {};
    const onState = (next: ApprovalActionState) => {
      seen.state = next;
    };
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(ActionHarness, { store, requestId, onState }),
      );
    });
    if (!renderer || !seen.state) {
      throw new Error("Harness never reported state");
    }
    return { renderer, seen, onState };
  }

  it("aborts the request a newer submission supersedes", async () => {
    const store = new DeferredDecisionStore();
    const { renderer, seen } = await renderHarness(store, REQUEST_ID);

    await act(async () => {
      void seen.state?.submit({ type: "approve" });
    });
    const [firstSignal] = store.decisionSignals;
    expect(firstSignal?.aborted).toBe(false);

    await act(async () => {
      void seen.state?.submit({ type: "approve" });
    });

    expect(store.decisionSignals).toHaveLength(2);
    expect(firstSignal?.aborted).toBe(true);
    expect(store.decisionSignals[1]?.aborted).toBe(false);

    await act(async () => renderer.unmount());
  });

  it("leaves a submission retired by a request change in flight", async () => {
    const store = new DeferredDecisionStore();
    const { renderer, seen, onState } = await renderHarness(store, REQUEST_ID);

    await act(async () => {
      void seen.state?.submit({ type: "approve" });
    });
    const [firstSignal] = store.decisionSignals;

    await act(async () => {
      renderer.update(
        createElement(ActionHarness, {
          store,
          requestId: "apr_action_2",
          onState,
        }),
      );
    });
    expect(firstSignal?.aborted).toBe(false);

    // A decision on the new request must not cancel the previous one's write.
    await act(async () => {
      void seen.state?.submit({ type: "reject" });
    });

    expect(store.decisionSignals).toHaveLength(2);
    expect(firstSignal?.aborted).toBe(false);

    await act(async () => renderer.unmount());
  });

  it("lets an in-flight decision finish after the hook unmounts", async () => {
    const store = new DeferredDecisionStore();
    const { renderer, seen } = await renderHarness(store, REQUEST_ID);

    let inFlight: Promise<ApprovalRecord> | undefined;
    await act(async () => {
      inFlight = seen.state?.submit({ type: "approve" });
    });
    const [signal] = store.decisionSignals;

    await act(async () => renderer.unmount());
    expect(signal?.aborted).toBe(false);

    const [decision] = store.pendingDecisions;
    if (!decision) throw new Error("Expected a decide call");
    await act(async () => {
      decision.resolve(approvedRecord);
    });
    await expect(inFlight).resolves.toBe(approvedRecord);
  });
});
