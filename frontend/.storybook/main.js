import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// CRA's eslint-webpack-plugin resolves `eslintConfig` from package.json, which
// only extends `plugin:storybook/recommended`. The app builds through craco,
// which adds `plugin:react-hooks/recommended` — so under Storybook the four
// `// eslint-disable-next-line react-hooks/exhaustive-deps` comments in src/
// reference a rule that doesn't exist and fail the build. Linting stays with
// the app build (`yarn build`); skip it here rather than fork the lint config.
process.env.DISABLE_ESLINT_PLUGIN = "true";

/** @type { import('@storybook/react-webpack5').StorybookConfig } */
const config = {
  "stories": [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [
    "@storybook/preset-create-react-app",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-onboarding",
    {
      name: "@storybook/addon-mcp",
      options: {
        endpoint: "/mcp",
      },
    }
  ],
  "framework": "@storybook/react-webpack5",
  "staticDirs": [
    "../public"
  ],
  // The app resolves `@/*` through craco (see craco.config.js), but Storybook
  // reuses CRA's webpack config directly and CRA only maps jsconfig
  // `baseUrl`. Mirror the app's alias so `@/lib/utils` and friends resolve
  // the same way here (Timeline → components/ui/dropdown-menu needs it).
  webpackFinal: async (webpackConfig) => {
    webpackConfig.resolve = {
      ...webpackConfig.resolve,
      alias: {
        ...(webpackConfig.resolve && webpackConfig.resolve.alias),
        "@": path.resolve(here, "../src"),
      },
    };
    return webpackConfig;
  },
};
export default config;
