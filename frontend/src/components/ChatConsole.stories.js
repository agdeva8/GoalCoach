import { fn } from "storybook/test";
import ChatConsole from "./ChatConsole";

export default {
  title: "Components/ChatConsole",
  component: ChatConsole,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    messages: [],
    onSend: fn(),
    onConfirm: fn(),
    onReject: fn(),
    onRefine: fn(),
    onOpenRefine: fn(),
    onOpenReject: fn(),
    busyProposal: null,
    autoAnswer: true,
    setAutoAnswer: fn(),
    grillMe: false,
    setGrillMe: fn(),
    onUploadFile: fn(),
    onAddLink: fn(),
    sources: [],
    onDeleteSource: fn(),
    onClearChat: fn(),
    pendingClarifications: null,
    onAnswerClarification: fn(),
    onDismissClarifications: fn(),
    showSources: true,
    focusOnMount: true,
    scopeLabel: "",
    scopeIntent: "",
    onViewGoal: null,
  },
};

export const Empty = {
  render: (args) => {
    const { component } = args;
    return component({ ...args, messages: [] });
  },
};

export const WithMessage = {
  render: (args) => {
    const { component } = args;
    return component({
      ...args,
      messages: [
        {
          id: "msg_1",
          role: "user",
          content: "I want to set a health goal",
          proposals: [],
          streaming: false,
        },
        {
          id: "msg_2",
          role: "assistant",
          content: "I propose: Add a health goal with 3 milestones and 2 weekly commitments.",
          proposals: [
            {
              id: "prop_1",
              action: "create_goal",
              args: { title: "Health goal", horizon: "short", why: "Be healthier", first_action: "Walk 10 min daily", target_date: "2026-12-01" },
              status: "pending",
            },
          ],
          streaming: false,
        },
      ],
    });
  },
};

export const WithChipPreFill = {
  render: (args) => {
    const { component } = args;
    // Simulate tapping a refine chip which pre-fills the textarea.
    const { onOpenRefine } = args;
    if (onOpenRefine) {
      onOpenRefine(args.messages[1].proposals[0]);
    }
    return component({ ...args });
  },
};

export const WithRejectChip = {
  render: (args) => {
    const { component } = args;
    const { onOpenReject } = args;
    if (onOpenReject) {
      onOpenReject(args.messages[1].proposals[0]);
    }
    return component({ ...args });
  },
};