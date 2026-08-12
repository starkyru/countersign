import type { Preview } from "@storybook/react-vite";
import "../src/styles.css";
import "./storybook.css";

const preview: Preview = {
  decorators: [
    (Story, context) => (
      <div className="storybook-canvas" data-theme={context.globals.theme}>
        <Story />
      </div>
    ),
  ],
  globalTypes: {
    theme: {
      description: "Countersign color theme",
      defaultValue: "light",
      toolbar: {
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
      },
    },
  },
  parameters: {
    a11y: { test: "error" },
    controls: { expanded: true },
    layout: "fullscreen",
  },
};

export default preview;

