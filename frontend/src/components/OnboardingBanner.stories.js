import OnboardingBanner from "./OnboardingBanner";

export default {
  title: "Components/OnboardingBanner",
  component: OnboardingBanner,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => {
      // The banner removes itself from the DOM forever once dismissed, so
      // clear the sentinel before the component reads it on mount.
      try {
        localStorage.removeItem("gc_onboard_dismissed");
      } catch {
        /* storage blocked — the banner will just show anyway */
      }
      return <Story />;
    },
  ],
};

export const Default = {};
