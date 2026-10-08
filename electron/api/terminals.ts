import { z } from "zod";
import { agentProviderSchema } from "../../shared/agents";
import { idSchema } from "../../shared/validation";
import {
  draftTerminalKey,
  TERMINAL_SLOT,
  terminalSlotKey,
} from "../../shared/terminals";
import { signInCommand } from "../agents/sign-in";
import { projectTasks } from "../terminal/tasks";
import { threadTerminals } from "../terminal/thread-terminals";
import { takes, type ApiContext, type Handlers } from "./context";

const slotSchema = z.string().regex(TERMINAL_SLOT);
const threadKeySchema = z.union([
  idSchema,
  z.templateLiteral(["draft:", idSchema]),
]);
const terminalKeySchema = z.union([
  threadKeySchema,
  z.templateLiteral([threadKeySchema, "~", slotSchema]),
]);
const terminalSizeSchema = z.object({
  cols: z.number().int().min(2).max(1000),
  rows: z.number().int().min(1).max(500),
});

/** A thread's shell, and the project's long-running tasks. */
export function terminalHandlers(ctx: ApiContext) {
  const { projects, projectChats } = ctx;
  const changeTask = (change: "stop" | "restart") =>
    takes([idSchema, z.string().max(64)], async (id, taskId) =>
      projectTasks[change](
        await projects.taskFolder(id),
        taskId,
        projectChats.worktreeFolders(id),
      ),
    );
  return {
    projectTasks: takes([idSchema], async (id) =>
      projectTasks.list(
        await projects.taskFolder(id),
        projectChats.worktreeFolders(id),
      ),
    ),
    stopProjectTask: changeTask("stop"),
    restartProjectTask: changeTask("restart"),
    openTerminal: takes(
      [
        idSchema,
        idSchema.nullable(),
        terminalSizeSchema,
        z.boolean().optional(),
        slotSchema.optional(),
      ],
      async (projectId, chatId, size, fresh, slot) => {
        const cwd = chatId
          ? await projectChats.terminalFolder(projectId, chatId)
          : await projects.root(projectId);
        return threadTerminals.open(
          terminalSlotKey(chatId ?? draftTerminalKey(projectId), slot ?? ""),
          cwd,
          size.cols,
          size.rows,
          fresh,
          chatId ? await projectChats.worktreeEnv(chatId) : {},
        );
      },
    ),
    closeTerminal: takes([terminalKeySchema], (key) =>
      threadTerminals.close(key),
    ),
    writeTerminal: takes(
      [terminalKeySchema, z.string().max(1 << 20)],
      (key, data) => threadTerminals.write(key, data),
    ),
    prefillSignIn: takes(
      [terminalKeySchema, agentProviderSchema],
      async (key, provider) => {
        const command = await signInCommand(provider);
        return !!command && threadTerminals.prefill(key, command);
      },
    ),
    prefillTerminal: takes(
      [terminalKeySchema, z.string().min(1).max(16_384)],
      (key, text) => threadTerminals.prefill(key, text),
    ),
    resizeTerminal: takes(
      [
        terminalKeySchema,
        terminalSizeSchema.shape.cols,
        terminalSizeSchema.shape.rows,
      ],
      (key, cols, rows) => threadTerminals.resize(key, cols, rows),
    ),
    ackTerminal: takes(
      [terminalKeySchema, z.number().int().nonnegative()],
      (key, bytes) => threadTerminals.ack(key, bytes),
    ),
    adoptTerminal: takes([idSchema, idSchema], async (projectId, chatId) => {
      // A thread in its own worktree starts its own shell there.
      if (await projectChats.worksInCheckout(projectId, chatId))
        threadTerminals.adopt(draftTerminalKey(projectId), chatId);
    }),
  } satisfies Handlers;
}
