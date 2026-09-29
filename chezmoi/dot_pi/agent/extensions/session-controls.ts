import { unlink } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * /exit — quit pi gracefully.
 * /clear — delete the current session file and start a fresh session.
 */
export default function (pi: ExtensionAPI) {
  pi.registerCommand("exit", {
    description: "Exit pi",
    handler: async (_args, ctx) => {
      ctx.shutdown();
    },
  });

  pi.registerCommand("clear", {
    description: "Delete the current session and start a fresh one",
    handler: async (_args, ctx) => {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("No session file to delete (ephemeral session).", "info");
        return;
      }

      const ok = await ctx.ui.confirm(
        "Clear session?",
        `Delete ${sessionFile} and start a new session? This cannot be undone.`
      );
      if (!ok) return;

      try {
        await unlink(sessionFile);
      } catch (err) {
        ctx.ui.notify(`Failed to delete session: ${err}`, "error");
        return;
      }

      await ctx.newSession();
    },
  });
}
