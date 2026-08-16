import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import type {
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

const otherRecord: ApprovalRecord = {
  id: "apr_race_2",
  status: "pending",
  created_at: "2026-08-16T10:01:00Z",
  action_request: {
    action: "rotate_production_key",
    args: { service: "billing-api" },
  },
  config: {
    allow_accept: true,
    allow_edit: false,
    allow_ignore: false,
    allow_respond: false,
  },
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

/** Hands back promises the test settles in whatever order it chooses. */
class DeferredStore implements ApprovalStore {
  readonly pendingAudits: Array<(events: AuditEvent[]) => void> = [];
  readonly pendingDecisions: Array<(record: ApprovalRecord) => void> = [];

  async list(): Promise<ApprovalRecord[]> {
    return [pendingRecord];
  }

  async get(): Promise<ApprovalRecord | null> {
    return pendingRecord;
  }

  decide(): Promise<ApprovalRecord> {
    return new Promise<ApprovalRecord>((resolve) => {
      this.pendingDecisions.push(resolve);
    });
  }

  audit(): Promise<AuditEvent[]> {
    return new Promise<AuditEvent[]>((resolve) => {
      this.pendingAudits.push(resolve);
    });
  }
}

async function renderCard(
  store: ApprovalStore,
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      createElement(ApprovalCard, { record: pendingRecord, store }),
    );
  });
  if (!renderer) throw new Error("Renderer was not created");
  return renderer;
}

function clickApprove(renderer: TestRenderer.ReactTestRenderer): Promise<void> {
  const approve = renderer.root.find(
    (node) =>
      node.type === "button" &&
      String(node.props.className ?? "").includes("cs-button--primary"),
  );
  return act(async () => {
    approve.props.onClick();
  });
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

function cardTitle(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findByType("h2").children.join("");
}

function cardStatus(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .find((node) =>
      String(node.props.className ?? "").startsWith("cs-status cs-status--"),
    )
    .children.join("");
}

describe("ApprovalCard decision history", () => {
  it("keeps the post-decision history when the mount audit load resolves last", async () => {
    const store = new DeferredStore();
    const renderer = await renderCard(store);
    expect(store.pendingAudits).toHaveLength(1);

    await clickApprove(renderer);
    const [decision] = store.pendingDecisions;
    if (!decision) throw new Error("Expected a decide call");
    await act(async () => {
      decision(approvedRecord);
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

    await act(async () => renderer.unmount());
  });

  it("drops a decision that lands after the card moved to another request", async () => {
    const store = new DeferredStore();
    const renderer = await renderCard(store);

    await clickApprove(renderer);
    expect(store.pendingDecisions).toHaveLength(1);

    // A queue refresh points this card at a different request mid-flight.
    await act(async () => {
      renderer.update(
        createElement(ApprovalCard, { record: otherRecord, store }),
      );
    });
    expect(cardTitle(renderer)).toBe("Rotate Production Key");

    const [decision] = store.pendingDecisions;
    if (!decision) throw new Error("Expected a decide call");
    await act(async () => {
      decision(approvedRecord);
    });

    expect(cardTitle(renderer)).toBe("Rotate Production Key");
    expect(cardStatus(renderer)).toBe("Awaiting review");
    expect(
      renderer.root.findAll(
        (node) => String(node.props.className ?? "") === "cs-success",
      ),
    ).toHaveLength(0);

    await act(async () => renderer.unmount());
  });
});
