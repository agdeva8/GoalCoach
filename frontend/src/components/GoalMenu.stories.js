import { fn } from "storybook/test";
import GoalMenu from "./GoalMenu";
import { SCREENS } from "../constants/screens";

export default {
  title: "Components/GoalMenu",
  component: GoalMenu,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {},
};

export const Default = {};

export const ActiveScreenToday = {
  args: {},
  // Override the default active screen so the dropdown shows Today as
  // the selected item instead of Goals.
  render: (args) => {
    const { component } = args;
    return component({
      ...args,
      "aria-current": "page",
    });
  },
};

export const ActiveScreenTimeline = {
  render: (args) => {
    const { component } = args;
    return component({
      ...args,
      // Mock the search params so the active screen is Timeline.
      location: { search: "?panel=timeline" },
    });
  },
};

export const ActiveScreenSources = {
  render: (args) => {
    const { component } = args;
    return component({
      ...args,
      location: { search: "?panel=sources" },
    });
  },
};

export const ActiveScreenMemories = {
  render: (args) => {
    const { component } = args;
    return component({
      ...args,
      location: { search: "?panel=memories" },
    });
  },
};

export const ActiveScreenAudit = {
  render: (args) => {
    const { component } = args;
    return component({
      ...args,
      location: { search: "?panel=audit" },
    });
  },
};