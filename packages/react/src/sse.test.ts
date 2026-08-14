import { describe, expect, it, vi } from "vitest";

import { ApprovalEventStreamError, consumeApprovalEvents } from "./sse";
import type { ApprovalSubscriptionEvent } from "./types";

const encoder = new TextEncoder();

function streamResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("consumeApprovalEvents", () => {
  it("reassembles split events and resumes from the last delivered event ID", async () => {
    const controller = new AbortController();
    const delivered: ApprovalSubscriptionEvent[] = [];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([
          'id: evt_1\ndata: {"id":"evt_1",',
          '"request_id":"apr_1","type":"requested","created_at":"2026-08-14T00:00:00Z"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        streamResponse([
          'id: evt_2\ndata: {"id":"evt_2","request_id":"apr_1","type":"approved","created_at":"2026-08-14T00:01:00Z"}\n\n',
        ]),
      );

    await consumeApprovalEvents({
      url: "https://api.example.test/v0/events",
      fetcher,
      headers: new Headers({ authorization: "Bearer test-token" }),
      credentials: "include",
      signal: controller.signal,
      listener(event) {
        delivered.push(event);
        if (event.id === "evt_2") controller.abort();
      },
    });

    expect(delivered).toEqual([
      {
        id: "evt_1",
        request_id: "apr_1",
        type: "requested",
        created_at: "2026-08-14T00:00:00Z",
      },
      {
        id: "evt_2",
        request_id: "apr_1",
        type: "approved",
        created_at: "2026-08-14T00:01:00Z",
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const secondHeaders = fetcher.mock.calls[1]?.[1]?.headers as Headers;
    expect(secondHeaders.get("last-event-id")).toBe("evt_1");
    expect(secondHeaders.get("authorization")).toBe("Bearer test-token");
  });

  it("backs off exponentially after transient failures", async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("still offline"))
      .mockResolvedValueOnce(
        streamResponse([
          'id: evt_1\ndata: {"id":"evt_1","request_id":"apr_1","type":"requested","created_at":"2026-08-14T00:00:00Z"}\n\n',
        ]),
      );

    await consumeApprovalEvents({
      url: "https://api.example.test/v0/events",
      fetcher,
      headers: new Headers(),
      credentials: "include",
      signal: controller.signal,
      retryDelay: async (milliseconds) => {
        delays.push(milliseconds);
      },
      listener() {
        controller.abort();
      },
    });

    expect(delays).toEqual([1_000, 2_000]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("honors bounded retry fields and ignores comment lines", async () => {
    const controller = new AbortController();
    const delivered: ApprovalSubscriptionEvent[] = [];
    const delays: number[] = [];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([
          ': keepalive\nretry: 0\nid: evt_1\ndata: {"id":"evt_1","request_id":"apr_1","type":"requested","created_at":"2026-08-14T00:00:00Z"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        streamResponse([
          'id: evt_2\ndata: {"id":"evt_2","request_id":"apr_1","type":"approved","created_at":"2026-08-14T00:01:00Z"}\n\n',
        ]),
      );

    await consumeApprovalEvents({
      url: "https://api.example.test/v0/events",
      fetcher,
      headers: new Headers(),
      credentials: "include",
      signal: controller.signal,
      retryDelay: async (milliseconds) => {
        delays.push(milliseconds);
      },
      listener(event) {
        delivered.push(event);
        if (event.id === "evt_2") controller.abort();
      },
    });

    expect(delays).toEqual([250]);
    expect(delivered.map((event) => event.id)).toEqual(["evt_1", "evt_2"]);
  });

  it("stops and surfaces authorization failures", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      consumeApprovalEvents({
        url: "https://api.example.test/v0/events",
        fetcher,
        headers: new Headers(),
        credentials: "include",
        signal: new AbortController().signal,
        listener() {},
      }),
    ).rejects.toEqual(
      new ApprovalEventStreamError("Event stream failed with 401", 401),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("absorbs reader cancellation failures when aborted mid-stream", async () => {
    const controller = new AbortController();
    let canceled = false;
    const response = new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(encoder.encode("id: partial"));
        },
        cancel() {
          canceled = true;
          return Promise.reject(new Error("transport already closed"));
        },
      }),
    );
    const fetcher = vi.fn().mockResolvedValue(response);

    const consuming = consumeApprovalEvents({
      url: "https://api.example.test/v0/events",
      fetcher,
      headers: new Headers(),
      credentials: "include",
      signal: controller.signal,
      listener() {},
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    controller.abort();
    await consuming;

    expect(canceled).toBe(true);
  });
});
