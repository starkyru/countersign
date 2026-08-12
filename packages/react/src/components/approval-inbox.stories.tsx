import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo } from "react";

import { createDemoStore } from "../mock";
import { InMemoryApprovalStore } from "../store";
import { ApprovalInbox } from "./approval-inbox";

function InboxStory({ empty = false }: { empty?: boolean }) {
  const store = useMemo(() => empty ? new InMemoryApprovalStore() : createDemoStore(), [empty]);
  return <ApprovalInbox store={store} />;
}

const meta = {
  title: "Review/ApprovalInbox",
  component: InboxStory,
  tags: ["autodocs"],
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof InboxStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FleetQueue: Story = { args: { empty: false } };
export const EmptyQueue: Story = { args: { empty: true } };
