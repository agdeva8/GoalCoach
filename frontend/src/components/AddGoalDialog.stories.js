import { fn, expect } from "storybook/test";
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

/**
 * Two goals back-to-back in one dialog session — the core regression
 * scenario for the operation-scoped context model (spec §14.5):
 * confirming goal #1 seals bucket 1 and swaps to the pre-minted next
 * bucket, so goal #2's chat never sees goal #1's history.
 *
 * The dialog opens in the tiles step; the play function picks a
 * category to land in the chat. The refId swap itself is asserted
 * against the live backend in the browser repro (manual check), not
 * here — Storybook has no server.
 */
export const TwoGoalsBackToBack = {
  play: async ({ canvas }) => {
    // Enter the chat phase via a category tile.
    await canvas.getByTestId("add-goal-category-health").click();
    // The isolated ChatConsole mounts with a fresh bucket.
    expect(canvas.getByTestId("chat-console")).toBeInTheDocument();
    expect(canvas.getByTestId("chat-input")).toBeInTheDocument();
  },
};
