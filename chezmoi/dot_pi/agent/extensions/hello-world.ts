import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("hello-world", {
    description: "Show a hello world notification",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Hello, world!", "info");
    },
  });
}
