import { fn, expect } from "storybook/test";
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

// Success divider after a confirm (spec §10.5) — the stream is NOT
// cleared; the banner separates bucket 1 from bucket 2.
export const WithSuccessBanner = {
  args: {
    messages: [
      ...messages,
      {
        id: "s1",
        role: "success",
        content: 'Created "Ship the v2 landing page"',
        goalId: "g_new",
        goalTitle: "Ship the v2 landing page",
        createdAt: new Date("2026-10-01T14:05:00").toISOString(),
      },
      {
        id: "msg_4",
        role: "user",
        content: "Great — now add a workout goal too.",
        proposals: [],
      },
      {
        id: "msg_5",
        role: "assistant",
        content: "Here's what adding that would change:",
        proposals: [],
        streaming: false,
      },
    ],
  },
  play: async ({ canvas }) => {
    expect(canvas.getByTestId("success-banner")).toBeInTheDocument();
    expect(canvas.getByText('Created "Ship the v2 landing page"')).toBeInTheDocument();
  },
};

// Structured [[IMPACT]] block attached to an assistant message
// (spec §10.5) — load shift + conflicts + recommendation.
export const WithImpactPanel = {
  args: {
    messages: [
      {
        id: "m1",
        role: "user",
        content: "add a marathon training goal",
        proposals: [],
      },
      {
        id: "m2",
        role: "assistant",
        content: "Here's how that lands against your week:",
        proposals: [],
        streaming: false,
        impact: {
          over_commitment: {
            from: "18 h/week",
            to: "26 h/week",
            reason: "Five runs plus your two existing strength sessions.",
          },
          conflicts: [
            { with: "Long run", type: "time", detail: "Overlaps Saturday family block." },
          ],
          buffer_warning: "Sunday has no recovery buffer left.",
          recommendation: "Shift the long run to Friday and cap week one at three runs.",
        },
      },
    ],
  },
  play: async ({ canvas }) => {
    expect(canvas.getByTestId("impact-panel")).toBeInTheDocument();
    expect(canvas.getByText(/Load: 18 h\/week → 26 h\/week/)).toBeInTheDocument();
    expect(canvas.getByText(/Shift the long run to Friday/)).toBeInTheDocument();
  },
};

// Empty state — scoped (the case from the screenshot: user opened
// chat from a "Miso-eggplant dinner" commitment, no messages yet).
// Verifies the empty body says *what this chat is for*, not the
// generic "Tell me everything..." onboarding.
export const EmptyScoped = {
  args: {
    messages: [],
    scopeLabel: "Miso-eggplant dinner",
    scopeIntent:
      "What part feels off? Be specific — the coach will suggest a keep / shrink / drop.",
  },
};

// Empty state — global header bar chat. Generic onboarding, kept
// verbatim so first-time users still land on the "what are you
// working on" prompt.
export const EmptyGeneric = {
  args: {
    messages: [],
    scopeLabel: "",
    scopeIntent: "",
  },
};
