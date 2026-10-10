import { z } from "zod";
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
  } satisfies Handlers;
}
