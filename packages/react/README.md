# @countersign-ai/react

Typed data primitives and accessible, styled review components for approval
queues. The package does not require a particular backend: swap the in-memory
demo store for any adapter implementing `ApprovalStore`.

## Styled inbox

Import the component stylesheet once, then give `ApprovalInbox` a store:

```tsx
"use client";

import {
  ApprovalInbox,
  HttpApprovalStore,
} from "@countersign-ai/react";
import "@countersign-ai/react/styles.css";
import { useMemo } from "react";

export function AgentReviews() {
  const store = useMemo(
    () => new HttpApprovalStore({ baseUrl: "/api/approvals" }),
    [],
  );

  return <ApprovalInbox pollIntervalMs={5_000} store={store} />;
}
```

`ApprovalInbox` includes the fleet queue, status/agent/environment filters,
responsive detail navigation, and a complete `ApprovalCard`. The card honors
the request's `allow_accept`, `allow_ignore`, `allow_edit`, and `allow_respond`
flags and records every decision through the supplied store.

Use individual pieces when composing your own layout:

```tsx
<ApprovalCard record={record} store={store} />
<ActionDiff
  action={record.action_request}
  beforeArgs={previousArgs}
  sensitivePaths={["/payment/token"]}
/>
<SchemaEditForm record={record} onSubmit={saveEditedArgs} />
<AuditTimeline events={events} />
```

The theme follows the nearest `data-theme="dark"` or
`data-countersign-theme="dark"` ancestor. Every critical action remains
available on narrow screens, focus states are keyboard-visible, status does
not rely on color alone, and reduced-motion preferences are honored.

Run the interactive component reference locally with `pnpm storybook` from
the repository root. Stories cover new and changed actions, redaction,
decision history, critical requests, resolved requests, full queues, empty
states, light/dark themes, and automated accessibility checks.

## Headless hooks

```tsx
"use client";

import { createDemoStore, useApprovalAction, useApprovalQueue } from "@countersign-ai/react";
import { useMemo } from "react";

export function Queue() {
  const store = useMemo(createDemoStore, []);
  const { records, loading, error, refresh } = useApprovalQueue({ store, status: "pending" });
  const first = records[0];
  const { submit, pending } = useApprovalAction(store, first?.id ?? "");

  if (loading) return <p>Loading approvals…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return <button disabled={!first || pending} onClick={() => void submit({ type: "approve" }).then(refresh)}>Approve</button>;
}
```

`ApprovalRequest` preserves Agent Inbox's `HumanInterrupt` fields, while
`ApprovalRecord` adds the queue status and persistence fields needed by a
reviewer UI. `InMemoryApprovalStore` is useful for demos and Storybook; it
keeps a small audit timeline, rejects a second decision on the same request,
and enforces action controls and edit-schema validation.

Filter a fleet view by agent, environment, action, or age:

```tsx
useApprovalQueue({
  store,
  filters: { graph_id: "refund-agent", environment: "production", older_than_seconds: 300 },
});
```

For an HTTP approval service, pass an `HttpApprovalStore` instead:

```ts
const store = new HttpApprovalStore({ baseUrl: "/api/approvals" });
```

`HttpApprovalStore` sends requests with `credentials: "include"` by default so
the adapter works with HttpOnly application sessions. Override the
`credentials` option for a bearer-only integration. A separately hosted API
must allow the application's explicit CORS origin.

For a short-lived bearer integration, provide the token once and it is
forwarded for every queue/action request:

```ts
const store = new HttpApprovalStore({
  baseUrl: "/api/approvals",
  headers: { Authorization: `Bearer ${token}` },
});
```

For structured edits, attach a JSON Schema as `context.edit_schema` to the
request and build the decision with `createValidatedEditDecision`. It throws
`ApprovalEditValidationError` instead of allowing invalid arguments to reach
the API:

```ts
const decision = createValidatedEditDecision(record, { order_id: "ord_4821", amount_usd: 99 });
await store.decide(record.id, decision);
```

For a reviewer-friendly field-level change model, use `diffProposedAction`.
Paths use JSON Pointer internally and a readable label for rendering; sensitive
paths can be redacted before passing the result into an audit or UI:

```ts
const diff = diffProposedAction(record.action_request, { order_id: "ord_4821", amount_usd: 99 }, {
  sensitivePaths: ["/payment_token"],
});
// diff.fields => [{ path: "/amount_usd", label: "amount_usd", kind: "changed", before: 129, after: 99, ... }]
```
