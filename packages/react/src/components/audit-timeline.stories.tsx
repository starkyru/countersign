import type { Meta, StoryObj } from "@storybook/react-vite";

import { AuditTimeline } from "./audit-timeline";

const meta = {
  title: "Review/AuditTimeline",
  component: AuditTimeline,
  tags: ["autodocs"],
  decorators: [(Story) => <div className="storybook-frame cs-card"><Story /></div>],
} satisfies Meta<typeof AuditTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DecisionAndExecution: Story = {
  args: {
    events: [
      { id: "evt_1", request_id: "apr_1", type: "requested", created_at: "2026-08-11T13:42:00Z" },
      { id: "evt_2", request_id: "apr_1", type: "edited", created_at: "2026-08-11T13:47:00Z", actor: { id: "usr_priya", name: "Priya Shah" }, decision: { type: "edit", args: { amount_usd: 99 } } },
      { id: "evt_3", request_id: "apr_1", type: "execution_completed", created_at: "2026-08-11T13:48:00Z", metadata: { message: "Refund rf_0381 issued" } },
    ],
  },
};

export const Loading: Story = { args: { events: [], loading: true } };

