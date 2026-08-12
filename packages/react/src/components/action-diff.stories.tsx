import type { Meta, StoryObj } from "@storybook/react-vite";

import { ActionDiff } from "./action-diff";

const meta = {
  title: "Review/ActionDiff",
  component: ActionDiff,
  tags: ["autodocs"],
  decorators: [(Story) => <div className="storybook-frame cs-card"><Story /></div>],
} satisfies Meta<typeof ActionDiff>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewAction: Story = {
  args: {
    action: { action: "send_email", args: { to: "customer@example.com", subject: "Renewal ready", send_now: true } },
    sensitivePaths: ["/to"],
  },
};

export const ChangedFields: Story = {
  args: {
    action: { action: "issue_refund", args: { amount_usd: 99, reason: "duplicate_charge", tags: ["priority"] } },
    beforeArgs: { amount_usd: 129, reason: "pending_review", internal_note: "Investigating" },
  },
};

