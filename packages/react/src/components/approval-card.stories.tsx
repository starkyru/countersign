import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo } from "react";

import { demoApprovals } from "../mock";
import { InMemoryApprovalStore } from "../store";
import type { ApprovalRecord } from "../types";
import { ApprovalCard } from "./approval-card";

function CardStory({ record }: { record: ApprovalRecord }) {
  const store = useMemo(() => new InMemoryApprovalStore([record]), [record]);
  return <div className="storybook-frame"><ApprovalCard record={record} store={store} /></div>;
}

const meta = {
  title: "Review/ApprovalCard",
  component: CardStory,
  tags: ["autodocs"],
  parameters: { controls: { disable: true } },
  args: { record: demoApprovals[0]! },
} satisfies Meta<typeof CardStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RefundReview: Story = {};
export const CriticalAction: Story = { args: { record: demoApprovals[2]! } };
export const Resolved: Story = {
  args: { record: { ...demoApprovals[1]!, status: "rejected", resolved_at: "2026-08-11T13:35:00Z", decision: { type: "reject", reason: "Recipient has opted out of renewal notices." } } },
};
