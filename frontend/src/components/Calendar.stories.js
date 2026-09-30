import { fn } from "storybook/test";
import Calendar from "./Calendar";
import { localDateKey } from "../lib/utils";

// Dates are anchored to "today" so the current week always carries markers
// no matter when the story is opened.
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDateKey(d);
};

const state = {
  goals: [
    {
      id: "g1",
      title: "Run a marathon",
      horizon: "long",
      status: "active",
      target_date: day(45),
    },
  ],
  milestones: [
    { id: "m1", title: "First 10k race", status: "open", target_date: day(6) },
    { id: "m2", title: "Half-marathon distance", status: "done", target_date: day(-4) },
  ],
  commitments: [
    { id: "c1", text: "Easy 5k before work", due: day(1), status: "open", goal_id: "g1" },
    { id: "c2", text: "Book the physio session", due: day(-2), status: "done", goal_id: "g1" },
  ],
  blockers: [
    {
      id: "b1",
      title: "Conference week",
      start_date: day(2),
      end_date: day(4),
      note: "No long runs",
    },
  ],
};

export default {
  title: "Components/Calendar",
  component: Calendar,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    state,
    onPrefill: fn(),
    onBlockerChange: fn(),
  },
};

export const Default = {};
