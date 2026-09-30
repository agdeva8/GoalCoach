import { fn } from "storybook/test";
import ToolConfirmationPrompt from "./ToolConfirmationPrompt";

export default {
  title: "Components/ToolConfirmationPrompt",
  component: ToolConfirmationPrompt,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  args: {
    proposal: {
      id: "prop_1",
      action: "create_goal",
      status: "pending",
      args: {
        title: "Ship the v2 landing page",
        why: "You've mentioned it three sessions running and it's blocking the career-pivot story.",
        horizon: "weekly",
        first_action: "Outline the five sections before Wednesday",
        target_date: "2026-10-12",
      },
    },
    onConfirm: fn(),
    onReject: fn(),
    onRefine: fn(),
    busy: false,
  },
};

export const Default = {};
