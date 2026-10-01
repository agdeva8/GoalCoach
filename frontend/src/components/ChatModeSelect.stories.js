import { fn } from "storybook/test";
import ChatModeSelect from "./ChatModeSelect";

export default {
  title: "Components/ChatModeSelect",
  component: ChatModeSelect,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    autoAnswer: false,
    grillMe: false,
    setAutoAnswer: fn(),
    setGrillMe: fn(),
  },
};

export const Default = {};

export const AutoAnswering = {
  args: { autoAnswer: true, grillMe: false },
};

export const GrillMe = {
  args: { autoAnswer: false, grillMe: true },
};
