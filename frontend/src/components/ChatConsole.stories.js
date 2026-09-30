import { fn } from "storybook/test";
import ChatConsole from "./ChatConsole";

const messages = [
  {
    id: "msg_1",
    role: "user",
    content: "I keep saying I'll write in the evenings and it never happens. Help me sort it.",
    proposals: [],
  },
  {
    id: "msg_2",
    role: "assistant",
    content:
      "You've got two evenings free this week before the launch crunch. Here's a proposal I'd like you to confirm:",
    proposals: [
      {
        id: "prop_1",
        action: "create_goal",
        status: "pending",
        title: "Ship the v2 landing page",
        why: "You've mentioned it three sessions running and it's blocking the career-pivot story.",
        horizon: "weekly",
        first_action: "Outline the five sections before Wednesday",
        target_date: "2026-10-12",
      },
    ],
  },
  {
    id: "msg_3",
    role: "assistant",
    content: "Once that's in the calendar I'll pad it for the launch crunch.",
    proposals: [],
  },
];

export default {
  title: "Components/ChatConsole",
  component: ChatConsole,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    messages,
    input: "",
    setInput: fn(),
    onSend: fn(),
    sending: false,
    busyProposal: null,
    autoAnswer: false,
    setAutoAnswer: fn(),
    grillMe: false,
    setGrillMe: fn(),
    onConfirm: fn(),
    onReject: fn(),
    onRefine: fn(),
    onUploadFile: fn(),
    onAddLink: fn(),
    sources: [{ id: 1, original_filename: "interview-notes.pdf" }],
    onDeleteSource: fn(),
    onClearChat: fn(),
    showSources: true,
    focusOnMount: false,
  },
};

export const Default = {};
