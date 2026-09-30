import { fn } from "storybook/test";
import TrackerCard from "./TrackerCard";
import { localDateKey } from "../lib/utils";

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDateKey(d);
};

const state = {
  goals: [
    { id: "g1", title: "Run a marathon", status: "active" },
    { id: "g2", title: "Ship the v2 landing page", status: "paused" },
  ],
  commitments: [
    { id: "c1", text: "Easy 5k before work", due: day(0), status: "open", goal_id: "g1" },
    { id: "c2", text: "Rewrite the CV summary", due: day(-1), status: "open", goal_id: "g2" },
    { id: "c3", text: "Send the copy to review", due: day(0), status: "done", goal_id: "g2" },
    { id: "c4", text: "Order new running socks", due: day(3), status: "open", goal_id: "g1" },
  ],
  milestones: [
    { id: "m1", title: "First 10k race", status: "open", target_date: day(2), goal_title: "Run a marathon" },
  ],
};

// The card renders TodayTimetable underneath, which fetches these itself.
const blockers = [];
const commitments = [
  { id: "c1", text: "Easy 5k before work", due: day(0), status: "open", goal_title: "Run a marathon", note: "" },
  { id: "c2", text: "Rewrite the CV summary", due: day(-1), status: "open", goal_title: "Ship the v2 landing page", note: "" },
  { id: "c3", text: "Send the copy to review", due: day(0), status: "done", goal_title: "Ship the v2 landing page", note: "" },
];

export default {
  title: "Components/TrackerCard",
  component: TrackerCard,
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
