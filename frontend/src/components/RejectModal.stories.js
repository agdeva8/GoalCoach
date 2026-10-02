import { fn } from "storybook/test";
import RejectModal from "./RejectModal";

export default {
  title: "Components/RejectModal",
  component: RejectModal,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    proposalTitle: "Ship side-project MVP in 2 months",
    proposalActionKey: "add_milestone",
  },
};

export const Empty = {
  render: (args) => {
    const { component } = args;
    return component({ ...args, open: false });
  },
};

export WithReason = {
  render: (args) => {
    const { component } = args;
    return component({
      ...args,
      reason: "The target date is too soon for my current capacity",
    });
  },
};

export const SkipReason = {
  render: (args) => {
    const { component } = args;
    return component({
      ...args,
      skipReason: true,
    });
  },
};