import { basename } from "node:path";
import type { ChatSummary, ProjectChat } from "../../shared/projects";
import { draftTerminalKey } from "../../shared/terminals";
import { currentBranchOr } from "../git/git";
import type { ProjectChats } from "../project-chats";
import type { Projects } from "../projects/projects";
import { projectTasks } from "../terminal/tasks";
import { localPort } from "./local-urls";
import { runningServerPorts } from "./running-server";
import type { ServerLinks } from "./server-links";
import type { PreviewTarget } from "./thread-previews";

/** The folders and server identity shared by the Browser and named links. */
export class PreviewProjects {
  constructor(
    private projects: Pick<Projects, "get" | "root">,
    private chats: Pick<
      ProjectChats,
      "get" | "terminalFolder" | "worktreeEnv" | "worktreeFolders"
    >,
    private summaries: () => ChatSummary[],
  ) {}

  async folders(chat: ProjectChat) {
    const project = this.projects.get(chat.projectId);
    const root = await this.projects.root(chat.projectId);
    const own = [
      ...(chat.worktree?.path && !chat.worktree.removedAt
        ? [{ path: chat.worktree.path, chatId: chat.id }]
        : []),
      ...(chat.agentWorktrees ?? []).map((w) => ({
        path: w.path,
        chatId: chat.id,
      })),
    ];
    return {
      project: basename(project.path),
      root,
      worktrees: [
        ...this.chats.worktreeFolders(chat.projectId),
        ...this.summaries()
          .filter((c) => c.projectId === chat.projectId)
          .flatMap((c) =>
            (c.agentWorktrees ?? []).map((w) => ({
              path: w.path,
              chatId: c.id,
            })),
          ),
        ...own,
      ],
      allowed: [...new Set([root, ...own.map((w) => w.path)])],
    };
  }

  async env(
    chat: ProjectChat,
    folder: string,
  ): Promise<Record<string, string>> {
    if (chat.worktree?.path === folder) return this.chats.worktreeEnv(chat.id);
    const root = await this.projects.root(chat.projectId);
    if (folder === root) return {};
    return {
      RELAY_WORKTREE: folder,
      RELAY_PROJECT_ROOT: root,
      RELAY_BRANCH: (await currentBranchOr(folder, "worktree")) ?? "worktree",
    };
  }

  async target(
    projectId: string,
    chatId: string | null,
    url: string | undefined,
    links: ServerLinks,
    preferredFolder?: string,
  ): Promise<PreviewTarget> {
    const chat = chatId
      ? await this.chats.get(chatId)
      : ({ id: draftTerminalKey(projectId), projectId } as ProjectChat);
    if (chat.projectId !== projectId)
      throw new Error("This thread belongs to another project.");
    const scope = await this.folders(chat);
    // Validate managed worktrees (removed or not yet made) before scanning.
    const primary = chatId
      ? await this.chats.terminalFolder(projectId, chatId)
      : scope.root;
    const tasks = await projectTasks.list(scope.root, scope.worktrees, {
      fresh: true,
      includeNewServers: true,
    });
    const live = new Map(
      await Promise.all(
        scope.allowed.map(
          async (folder) =>
            [
              folder,
              await runningServerPorts(
                tasks.filter((t) => t.folder === folder),
              ),
            ] as const,
        ),
      ),
    );
    const requested = localPort(url ?? "");
    let folder = primary;
    if (requested) {
      const matches = [...live].filter(([, ports]) =>
        ports.includes(requested),
      );
      if (matches.length === 1) folder = matches[0]![0];
    } else if (primary === scope.root) {
      const worktrees = [...live].filter(
        ([path, ports]) => path !== scope.root && ports.length,
      );
      if (worktrees.length > 1) {
        if (!worktrees.some(([path]) => path === preferredFolder))
          throw new Error(
            "Several of this thread's worktrees have HTTP servers. Open an explicit localhost URL to choose one.",
          );
        folder = preferredFolder!;
      }
      if (worktrees.length === 1) folder = worktrees[0]![0];
    }
    const env = await this.env(chat, folder);
    const settings = this.projects.get(projectId).settings;
    const configured = settings?.devPort
      ? settings.devPort + (Number(env.RELAY_PORT_OFFSET) || 0)
      : undefined;
    const ports = live.get(folder) ?? [];
    const select = (ports: number[]) =>
      configured && ports.includes(configured)
        ? configured
        : ports.length === 1
          ? ports[0]
          : undefined;
    const port =
      requested ??
      select(ports) ??
      (ports.length === 0 ? configured : undefined);
    const branch =
      folder !== scope.root
        ? await currentBranchOr(folder, "worktree")
        : undefined;
    const checkoutPartition = `persist:project-${projectId}`;
    return {
      key: chat.id,
      projectId,
      chatId,
      project: scope.project,
      folder,
      branch,
      ...(branch ? { worktree: branch } : {}),
      checkoutPartition,
      partition: chatId ? `persist:thread-${chatId}` : checkoutPartition,
      env,
      ...(port
        ? {
            dev: {
              port,
              ...(port === configured ? { command: settings?.devCommand } : {}),
            },
          }
        : {}),
      external: (port) => links.route(chat, folder, port),
    };
  }
}
