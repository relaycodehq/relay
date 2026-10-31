import { z } from "zod";
import { mainWindowCommands } from "../../shared/thread-windows";
import { takes, type ApiContext, type Handlers } from "./context";

const idSchema = z.string().min(1).max(200);

/** Threads popped out of the main window into windows of their own. */
export function threadWindowHandlers(ctx: ApiContext) {
  const { window, store } = ctx;
  /** The thread, as long as it's still there in that project. */
  const thread = (projectId: string, chatId: string) => {
    const chat = store.get().chats?.find((c) => c.id === chatId);
    if (!chat || chat.projectId !== projectId)
      throw new Error("That thread isn't here anymore.");
    return { projectId, chatId };
  };
  return {
    threadWindows: () => window.threads.state(),
    openThreadWindow: takes([idSchema, idSchema], (projectId, chatId) =>
      window.threads.open(thread(projectId, chatId)),
    ),
    returnThreadWindow: takes([idSchema], (chatId) =>
      window.threads.giveBack(chatId),
    ),
    openInMainWindow: takes(
      [idSchema, idSchema.optional()],
      (projectId, chatId) => {
        if (chatId) window.openThread(thread(projectId, chatId));
        else window.open();
      },
    ),
    takeOpenThread: () => window.takeThread(),
    runInMainWindow: takes(
      [
        z.union([
          z.enum(mainWindowCommands),
          z
            .object({
              settings: z.string().min(1).max(40),
              projectId: idSchema.optional(),
              entryId: z.string().min(1).max(80).optional(),
            })
            .strict(),
        ]),
      ],
      (command) => window.runCommand(command),
    ),
    takeMainWindowCommand: () => window.takeCommand(),
    // Pinning is the popped-out windows' own, an editor's as much as a thread's.
    windowPinned: () => {
      const win = window.caller();
      if (!win) return false;
      return window.threads.pinned(win) ?? window.editors.pinned(win) ?? false;
    },
    pinWindow: takes([z.boolean()], (pinned) => {
      const win = window.caller();
      const popped =
        !!win &&
        (window.threads.pin(win, pinned) || window.editors.pin(win, pinned));
      if (!popped)
        throw new Error(
          "Only a thread's or an editor's own window stays on top.",
        );
    }),
  } satisfies Handlers;
}
