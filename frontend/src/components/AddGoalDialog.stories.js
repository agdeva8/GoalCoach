import { fn } from "storybook/test";
import AddGoalDialog from "./AddGoalDialog";

export default {
  title: "Components/AddGoalDialog",
  component: AddGoalDialog,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onClose: fn(),
    autoAnswer: true,
    grillMe: false,
    onUploadSource: fn(),
    onAddLink: fn(),
    onDeleteSource: fn(),
    onGoalConfirmed: fn(),
  },
};

export const Default = {};
