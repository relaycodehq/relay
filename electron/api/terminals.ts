import { z } from "zod";
import { idSchema } from "../../shared/rooms";
import { draftTerminalKey } from "../../shared/terminals";
import { claudeSignInCommand } from "../rooms/claude-sign-in";
import { projectTasks } from "../tasks";
import { threadTerminals } from "../thread-terminals";
import type { ApiContext, Handlers } from "./context";

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
  async function changeTask(args: unknown[], change: "stop" | "restart") {
    const id = idSchema.parse(args[0]);
    return projectTasks[change](
      await projects.taskFolder(id),
      z.string().max(64).parse(args[1]),
      projectChats.worktreeFolders(id),
    );
  }
  return {
    projectTasks: async (args) => {
      const id = idSchema.parse(args[0]);
      return projectTasks.list(
        await projects.taskFolder(id),
        projectChats.worktreeFolders(id),
      );
    },
    stopProjectTask: (args) => changeTask(args, "stop"),
    restartProjectTask: (args) => changeTask(args, "restart"),
    openTerminal: async (args) => {
      const projectId = idSchema.parse(args[0]);
      const chatId = idSchema.nullable().parse(args[1]);
      const size = terminalSizeSchema.parse(args[2]);
      const cwd = chatId
        ? await projectChats.terminalFolder(projectId, chatId)
        : await projects.root(projectId);
      return threadTerminals.open(
        chatId ?? draftTerminalKey(projectId),
        cwd,
        size.cols,
        size.rows,
        z.boolean().optional().parse(args[3]),
      );
    },
    writeTerminal: (args) =>
      threadTerminals.write(
        terminalKeySchema.parse(args[0]),
        z
          .string()
          .max(1 << 20)
          .parse(args[1]),
      ),
    prefillClaudeSignIn: async (args) =>
      threadTerminals.prefill(
        terminalKeySchema.parse(args[0]),
        await claudeSignInCommand(),
      ),
    resizeTerminal: (args) => {
      const size = terminalSizeSchema.parse({ cols: args[1], rows: args[2] });
      return threadTerminals.resize(
        terminalKeySchema.parse(args[0]),
        size.cols,
        size.rows,
      );
    },
    ackTerminal: (args) =>
      threadTerminals.ack(
        terminalKeySchema.parse(args[0]),
        z.number().int().nonnegative().parse(args[1]),
      ),
    adoptTerminal: async (args) => {
      const projectId = idSchema.parse(args[0]);
      const chatId = idSchema.parse(args[1]);
      // A thread in its own worktree starts its own shell there.
      if (await projectChats.worksInCheckout(projectId, chatId))
        threadTerminals.adopt(draftTerminalKey(projectId), chatId);
    },
  } satisfies Handlers;
}
