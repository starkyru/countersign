import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalEventStreamError } from "../sse";
import type {
  ApprovalDecision,
  ApprovalQueueFilter,
  ApprovalRecord,
  ApprovalStore,
  ApprovalSubscriptionEvent,
  AuditEvent,
} from "../types";
import {
  useApprovalQueue,
  type ApprovalQueueState,
} from "./use-approval-queue";

class RecordingStore implements ApprovalStore {
  listCalls = 0;
  subscribeCalls = 0;
  unsubscribeCalls = 0;
  streamError: ((error: Error) => void) | undefined;

  async list(_input?: ApprovalQueueFilter): Promise<ApprovalRecord[]> {
    this.listCalls += 1;
    return [];
  }

  async get(): Promise<ApprovalRecord | null> {
    return null;
  }

  async decide(
    _id: string,
    _decision: ApprovalDecision,
  ): Promise<ApprovalRecord> {
    throw new Error("Not used by this test");
  }

  async audit(): Promise<AuditEvent[]> {
    return [];
  }

  subscribe(
    _listener: (event: ApprovalSubscriptionEvent) => void,
    onError?: (error: Error) => void,
  ): () => void {
    this.subscribeCalls += 1;
    this.streamError = onError;
    return () => {
      this.unsubscribeCalls += 1;
    };
  }
}

function QueueHarness({
  store,
  storeKey,
  onState,
}: {
  store: ApprovalStore;
  storeKey?: string;
  onState(state: ApprovalQueueState): void;
}) {
  onState(useApprovalQueue({ store, storeKey, pollIntervalMs: 5_000 }));
  return null;
}

describe("useApprovalQueue live updates", () => {
  const setInterval = vi.fn(() => 17);
  const clearInterval = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("window", { setInterval, clearInterval });
    setInterval.mockClear();
    clearInterval.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps one healthy stream across inline store instances and surfaces fatal errors", async () => {
    const first = new RecordingStore();
    const second = new RecordingStore();
    let state: ApprovalQueueState | undefined;
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(QueueHarness, {
          store: first,
          onState: (next) => {
            state = next;
          },
        }),
      );
    });
    await act(async () => {
      if (!renderer) throw new Error("Renderer was not created");
      renderer.update(
        createElement(QueueHarness, {
          store: second,
          onState: (next) => {
            state = next;
          },
        }),
      );
    });

    expect(first.subscribeCalls).toBe(1);
    expect(first.listCalls).toBe(1);
    expect(second.subscribeCalls).toBe(0);
    expect(second.listCalls).toBe(0);
    expect(setInterval).not.toHaveBeenCalled();

    await act(async () => {
      first.streamError?.(new ApprovalEventStreamError("Unauthorized", 401));
    });
    expect(state?.error).toEqual(
      new ApprovalEventStreamError("Unauthorized", 401),
    );
    expect(setInterval).not.toHaveBeenCalled();

    await act(async () => {
      first.streamError?.(new ApprovalEventStreamError("Unavailable", 404));
    });
    expect(setInterval).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      5_000,
    );

    await act(async () => renderer?.unmount());
    expect(first.unsubscribeCalls).toBe(1);
    expect(clearInterval).toHaveBeenCalledWith(17);
  });

  it("replaces both refresh and subscription when storeKey changes", async () => {
    const first = new RecordingStore();
    const second = new RecordingStore();
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(QueueHarness, {
          store: first,
          storeKey: "first",
          onState: () => undefined,
        }),
      );
    });
    await act(async () => {
      renderer?.update(
        createElement(QueueHarness, {
          store: second,
          storeKey: "second",
          onState: () => undefined,
        }),
      );
    });

    expect(first.subscribeCalls).toBe(1);
    expect(first.unsubscribeCalls).toBe(1);
    expect(first.listCalls).toBe(1);
    expect(second.subscribeCalls).toBe(1);
    expect(second.listCalls).toBe(1);

    await act(async () => renderer?.unmount());
    expect(second.unsubscribeCalls).toBe(1);
  });
});
