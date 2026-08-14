import { describe, expect, it, vi } from "vitest";

import { HttpApprovalStore } from "./http-store";
import { ApprovalEventStreamError } from "./sse";

describe("HttpApprovalStore subscriptions", () => {
  it("reports a terminal authorization error without reconnecting", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 403 }));
    const store = new HttpApprovalStore({
      baseUrl: "https://api.example.test",
      fetcher,
    });

    const error = await new Promise<Error>((resolve) => {
      store.subscribe(() => undefined, resolve);
    });

    expect(error).toEqual(
      new ApprovalEventStreamError("Event stream failed with 403", 403),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
