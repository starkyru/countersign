import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import type {
  ApprovalDecision,
  ApprovalRecord,
  ApprovalStore,
  AuditEvent,
} from "../types";
import { ApprovalCard } from "./approval-card";

const REQUEST_ID = "apr_race_1";

const pendingRecord: ApprovalRecord = {
  id: REQUEST_ID,
  status: "pending",
  created_at: "2026-08-16T10:00:00Z",
  action_request: {
    action: "issue_refund",
    args: { order_id: "ord_1", amount_usd: 25 },
  },
  config: {
    allow_accept: true,
    allow_edit: false,
    allow_ignore: false,
    allow_respond: false,
  },
};

const approvedRecord: ApprovalRecord = {
  ...pendingRecord,
  status: "approved",
  decision: { type: "approve" },
  resolved_at: "2026-08-16T10:00:05Z",
};

function auditEvent(
  id: string,
  type: AuditEvent["type"],
  createdAt: string,
): AuditEvent {
  return { id, request_id: REQUEST_ID, type, created_at: createdAt };
}

const requestedEvent = auditEvent(
  "evt_1",
  "requested",
  "2026-08-16T10:00:00Z",
);
const approvedEvent = auditEvent("evt_2", "approved", "2026-08-16T10:00:05Z");

/** Hands back audit promises the test resolves in whatever order it chooses. */
class DeferredAuditStore implements ApprovalStore {
  readonly pendingAudits: Array<(events: AuditEvent[]) => void> = [];

  async list(): Promise<ApprovalRecord[]> {
    return [pendingRecord];
  }

  async get(): Promise<ApprovalRecord | null> {
    return pendingRecord;
  }

  async decide(
    _id: string,
    _decision: ApprovalDecision,
  ): Promise<ApprovalRecord> {
    return approvedRecord;
  }

  audit(): Promise<AuditEvent[]> {
    return new Promise<AuditEvent[]>((resolve) => {
      this.pendingAudits.push(resolve);
    });
  }
}

function timelineLabels(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll(
      (node) =>
        node.type === "li" &&
        String(node.props.className ?? "").includes("cs-timeline__event"),
    )
    .map((event) => event.findByType("strong").children.join(""));
}

describe("ApprovalCard decision history", () => {
  it("keeps the post-decision history when the mount audit load resolves last", async () => {
    const store = new DeferredAuditStore();
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(ApprovalCard, { record: pendingRecord, store }),
      );
    });
    if (!renderer) throw new Error("Renderer was not created");
    expect(store.pendingAudits).toHaveLength(1);

    const approve = renderer.root.find(
      (node) =>
        node.type === "button" &&
        String(node.props.className ?? "").includes("cs-button--primary"),
    );
    await act(async () => {
      approve.props.onClick();
    });

    const [mountLoad, decisionLoad] = store.pendingAudits;
    if (!mountLoad || !decisionLoad) {
      throw new Error("Expected a mount audit load and a post-decision one");
    }

    // The post-decision request wins the race; the mount request lands after it.
    await act(async () => {
      decisionLoad([requestedEvent, approvedEvent]);
    });
    await act(async () => {
      mountLoad([requestedEvent]);
    });

    expect(timelineLabels(renderer)).toEqual([
      "Approval requested",
      "Action approved",
    ]);

    await act(async () => renderer?.unmount());
  });
});
