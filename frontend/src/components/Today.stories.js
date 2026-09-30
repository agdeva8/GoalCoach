import { fn } from "storybook/test";
import Today from "./Today";
import { localDateKey } from "../lib/utils";

// Items are filtered against today's local date key, so "today" and a
// couple of days out keep the list populated whenever the story is opened.
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDateKey(d);
};

const blockers = [
  {
    id: "b1",
    title: "Deep-work block: no meetings",
    start_date: day(0),
    end_date: day(0),
    note: "Protect the morning",
  },
];

const commitments = [
  { id: "c1", text: "Rewrite the CV summary", due: day(-1), status: "open", goal_title: "Switch into platform engineering", note: "" },
  { id: "c2", text: "Easy 5k before work", due: day(0), status: "open", goal_title: "Run a marathon", note: "" },
  { id: "c3", text: "Send the landing page copy to review", due: day(0), status: "done", goal_title: "Ship the v2 landing page", note: "Sent 09:40" },
];

const state = {
  goals: [
    { id: "g1", title: "Run a marathon", status: "active", horizon: "long" },
    { id: "g2", title: "Switch into platform engineering", status: "active", horizon: "medium" },
    { id: "g3", title: "Ship the v2 landing page", status: "paused", horizon: "weekly" },
  ],
};

export default {
  title: "Components/Today",
  component: Today,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    api: { blockers, commitments },
  },
  args: {
    state,
    onChange: fn(),
    onOpenChat: fn(),
  },
};

export const Default = {};

export const Empty = {
  parameters: {
    api: { blockers: [], commitments: [] },
  },
};
