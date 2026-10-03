import { z } from "zod";
import { idSchema } from "../../shared/rooms";
import { draftTerminalKey } from "../../shared/terminals";
import { claudeSignInCommand } from "../rooms/claude-sign-in";
import { projectTasks } from "../terminal/tasks";
import { threadTerminals } from "../terminal/thread-terminals";
import { takes, type ApiContext, type Handlers } from "./context";

const terminalKeySchema = z.union([
  idSchema,
  z.templateLiteral(["draft:", idSchema]),
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
      ],
      async (projectId, chatId, size, fresh) => {
        const cwd = chatId
          ? await projectChats.terminalFolder(projectId, chatId)
          : await projects.root(projectId);
        return threadTerminals.open(
          chatId ?? draftTerminalKey(projectId),
          cwd,
          size.cols,
          size.rows,
          fresh,
        );
      },
    ),
    writeTerminal: takes(
      [terminalKeySchema, z.string().max(1 << 20)],
      (key, data) => threadTerminals.write(key, data),
    ),
    prefillClaudeSignIn: takes([terminalKeySchema], async (key) =>
      threadTerminals.prefill(key, await claudeSignInCommand()),
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
