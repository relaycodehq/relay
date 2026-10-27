// A thread's agent moving it into a worktree in the middle of its answer.

import { sentAgent } from "../../shared/recipient";
import { noteWorkspaceMove } from "../../shared/workspace-moves";
import {
  copyIntoWorktree,
  createWorktree,
  newBranchProblem,
} from "../git/worktrees";
import type { ChatCore } from "./core";
import type { WorktreeSetup } from "./worktree-setup";
import type { ThreadWorktrees } from "./worktrees";

/** What an agent asks for when it moves its thread into a worktree. */
export interface WorktreeRequest {
  branch?: string;
  uncommitted?: boolean;
}

export class WorktreeEntry {
  constructor(
    private core: ChatCore,
    /** The folder Relay makes threads' worktrees in. */
    private folder: string,
    private setup: WorktreeSetup,
    private repo: Pick<ThreadWorktrees, "inRepo" | "inRepoSettled">,
  ) {}

  /**
   * Moves a project-folder thread into a worktree of its own while its agent
   * answers, at the agent's asking: from the checkout's commit, with a copy
   * of its uncommitted edits when `uncommitted`. Unlike `move`, the project
   * folder keeps its edits, since other threads may be at work there. The
   * agent runs the project's setup itself, as nothing else may run in the
   * middle of its answer.
   */
  enter(id: string, { branch, uncommitted: copy }: WorktreeRequest) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      if (chat.worktree)
        throw new Error(
          chat.worktree.path && !chat.worktree.removedAt
            ? `This thread already works in its own worktree, ${chat.worktree.path}${chat.worktree.branch ? ` on ${chat.worktree.branch}` : ""}.`
            : "This thread already has its own worktree.",
        );
      if (chat.scope.kind !== "project" || chat.reviewer)
        throw new Error("Only repository threads can work in a worktree.");
      if ((await this.core.projects.inspect(chat.projectId)).plain)
        throw new Error("Worktrees need a Git repository.");
      if (chat.activeAgentWorktree)
        throw new Error(
          `This thread works in ${chat.activeAgentWorktree.path}, a worktree it made earlier. The user can switch it back to the project folder first.`,
        );
      const root = await this.core.projects.root(chat.projectId);
      const problem = branch && (await newBranchProblem(root, branch));
      if (problem) throw new Error(problem);
      const { worktree, copied } = await this.repo.inRepo(root, async () =>
        copy
          ? await copyIntoWorktree(
              root,
              this.folder,
              chat.title,
              root,
              id,
              branch,
            )
          : {
              worktree: await createWorktree(
                root,
                this.folder,
                chat.title,
                branch ? { named: branch } : undefined,
              ),
              copied: 0,
            },
      );
      const { included: _, ...made } = worktree;
      chat.worktree = { ...made, setup: "done" };
      chat.branch = made.branch;
      delete chat.commit;
      // The agent that asked knows; the thread's other agents hear it next time.
      const active = this.core.active.get(id);
      const caller = active?.input ?? chat.lastInput;
      const asker = caller ? `${sentAgent(caller)}:main` : undefined;
      const owed = Object.keys(chat.scopeHeard ?? {}).filter(
        (key) => key !== asker,
      );
      noteWorkspaceMove(chat, {
        how: "moved",
        to: made.path,
        ...(made.branch ? { branch: made.branch } : {}),
        unasked: true,
        ...(caller ? { by: sentAgent(caller) } : {}),
      });
      if (owed.length)
        chat.movedIn = {
          from: root,
          to: made.path,
          owed,
          ...(copy ? { copied: true as const } : { fresh: true as const }),
        };
      await this.core.storage.save(chat);
      await active?.moved?.(made.path);
      const setup = this.setup.command(chat);
      const env = await this.setup.env(chat);
      return {
        folder: made.path,
        branch: made.branch,
        ...(made.from ? { from: made.from } : {}),
        ...(copy ? { uncommittedFilesCopied: copied } : {}),
        ...(setup ? { setupCommand: setup } : {}),
        ...(Object.keys(env).length ? { environment: env } : {}),
      };
    });
  }
}
