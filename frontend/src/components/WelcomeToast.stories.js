import WelcomeToast from "./WelcomeToast";
import { localDateKey } from "../lib/utils";

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDateKey(d);
};

const state = {
  goals: [
    { id: "g1", title: "Run a marathon", status: "active" },
    { id: "g2", title: "Ship the v2 landing page", status: "active" },
  ],
  commitments: [
    { id: "c1", text: "Easy 5k before work", due: day(0), status: "open" },
    { id: "c2", text: "Rewrite the CV summary", due: day(-1), status: "open" },
    { id: "c3", text: "Send the copy to review", due: day(0), status: "open" },
    { id: "c4", text: "Order new running socks", due: day(0), status: "open" },
  ],
};

export default {
  title: "Components/WelcomeToast",
  component: WelcomeToast,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => {
      // The greeting is once-per-day, guarded by localStorage — clear the
      // sentinel so every story mount actually fires it.
      try {
        localStorage.removeItem("gc_welcome_date");
      } catch {
        /* storage blocked — falls through to the toast anyway */
      }
      return <Story />;
    },
  ],
  args: {
    user: { user_id: "user_story01", name: "Devansh Agarwal" },
    state,
    signedIn: true,
  },
};

export const Default = {};
