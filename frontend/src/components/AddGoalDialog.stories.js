import { fn } from "storybook/test";
import AddGoalDialog from "./AddGoalDialog";

export default {
  title: "Components/AddGoalDialog",
  component: AddGoalDialog,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    autoAnswer: true,
    grillMe: false,
    onUploadSource: fn(),
    onAddLink: fn(),
    onDeleteSource: fn(),
    onGoalConfirmed: fn(),
  },
};

export const Tiles = {
  render: (args) => {
    const { component } = args;
    return component({ ...args, open: true });
  },
};

export const ChatStepNoMilestones = {
  render: (args) => {
    const { component } = args;
    return component({
      ...args,
      messages: [
        {
          id: `stream_1`,
          role: "assistant",
          content: "I see you want a health goal. I propose: Add a health goal with 3 milestones and 2 weekly commitments.",
          proposals: [
            {
              id: "prop_001",
              action: "create_goal",
              args: { title: "Health goal", horizon: "short", why: "Be healthier", first_action: "Walk 10 min daily", target_date: "2026-12-01" },
              status: "pending",
            },
          ],
          streaming: false,
        },
      ],
      pendingClarifications: null,
      onGoalConfirmed: fn(),
    });
  },
};

export const ChatStepWithMilestones = {
  render: (args) => {
    const { component } = args;
    return component({
      ...args,
      messages: [
        {
          id: `stream_2`,
          role: "assistant",
          content: "I see you want a health goal. I propose: Add a health goal with 3 milestones and 2 weekly commitments.",
          proposals: [
            {
              id: "prop_002",
              action: "create_goal",
              args: {
                title: "Health goal",
                horizon: "short",
                why: "Be healthier",
                first_action: "Walk 10 min daily",
                target_date: "2026-12-01",
              },
              status: "pending",
            },
            {
              id: "prop_003",
              action: "add_milestone",
              args: { title: "Walk 10 min daily", target_date: "2026-11-01" },
              status: "pending",
            },
          ],
          streaming: false,
        },
      ],
      pendingClarifications: null,
      onGoalConfirmed: fn(),
    });
  },
};