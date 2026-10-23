import { basename } from "node:path";
import type { ChatSummary, ProjectChat } from "../../shared/projects";
import { draftTerminalKey } from "../../shared/terminals";
import { currentBranchOr } from "../git/git";
import type { ProjectChats } from "../project-chats";
import type { Projects } from "../projects/projects";
import { projectTasks } from "../terminal/tasks";
import { localPort } from "./local-urls";
import { runningServerPorts } from "./running-server";
import type { PreviewTarget } from "./thread-previews";
import type { SavedPreview } from "./saved-previews";

/** The configured port in this worktree, validated before any socket is opened. */
export function worktreeDevPort(port: number, env: Record<string, string>) {
  const effective = port + (Number(env.RELAY_PORT_OFFSET) || 0);
  if (!Number.isInteger(effective) || effective < 1 || effective > 65535)
    throw new Error(
      `The dev port ${port} plus worktree offset ${env.RELAY_PORT_OFFSET ?? "0"} must be between 1 and 65535. Change the project’s dev port or worktree offset.`,
    );
  return effective;
}

/** The folders and server identity shared by the Browser and named links. */
export class PreviewProjects {
  constructor(
    private projects: Pick<Projects, "get" | "root">,
    private chats: Pick<ProjectChats, "get" | "worktreeEnv"> & {
      worktrees: Pick<ProjectChats["worktrees"], "folders" | "terminalFolder">;
    },
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
        ...this.chats.worktrees.folders(chat.projectId),
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
    preferredFolder?: string,
    saved?: SavedPreview,
  ): Promise<PreviewTarget> {
    const chat = chatId
      ? await this.chats.get(chatId)
      : ({ id: draftTerminalKey(projectId), projectId } as ProjectChat);
    if (chat.projectId !== projectId)
      throw new Error("This thread belongs to another project.");
    const scope = await this.folders(chat);
    // Validate managed worktrees (removed or not yet made) before scanning.
    const primary = chatId
      ? await this.chats.worktrees.terminalFolder(projectId, chatId)
      : scope.root;
    const settings = this.projects.get(projectId).settings;
    const sameSettings =
      settings?.devCommand === saved?.settings.devCommand &&
      settings?.devPort === saved?.settings.devPort;
    let folder = primary;
    if (preferredFolder) {
      if (!scope.allowed.includes(preferredFolder))
        throw new Error(
          "The saved preview's folder is no longer part of this thread. Open a new address to choose a preview here.",
        );
      folder = preferredFolder;
    }
    // Changing the configured port keeps the saved path on the new server.
    if (
      url &&
      url === saved?.url &&
      saved.settings.devPort &&
      settings?.devPort &&
      !sameSettings &&
      folder === saved.folder
    ) {
      const env = await this.env(chat, folder);
      if (localPort(url) === worktreeDevPort(saved.settings.devPort, env)) {
        const next = new URL(url);
        next.port = String(worktreeDevPort(settings.devPort, env));
        url = next.href;
      }
    }
    const requested = localPort(url ?? "");
    const remote = !!url && /^https?:\/\//i.test(url) && !requested;
    // External pages need workspace validation, but no process inventory or
    // socket probes. Local preview ownership still comes from fresh discovery.
    const live = new Map<string, number[]>();
    if (!remote) {
      const tasks = await projectTasks.list(scope.root, scope.worktrees, {
        fresh: true,
        includeNewServers: true,
      });
      await Promise.all(
        scope.allowed.map(async (folder) => {
          live.set(
            folder,
            await runningServerPorts(tasks.filter((t) => t.folder === folder)),
          );
        }),
      );
    }
    if (requested) {
      const matches = [...live].filter(([, ports]) =>
        ports.includes(requested),
      );
      if (
        preferredFolder &&
        matches.length &&
        !matches.some(([path]) => path === preferredFolder)
      )
        throw new Error(
          `The saved preview's port ${requested} is being used by another worktree. Open a new address or change the dev port.`,
        );
      if (!preferredFolder && matches.length === 1) folder = matches[0]![0];
    } else if (!remote && primary === scope.root && !preferredFolder) {
      const worktrees = [...live].filter(
        ([path, ports]) => path !== scope.root && ports.length,
      );
      if (worktrees.length > 1) {
        throw new Error(
          "Several of this thread's worktrees have HTTP servers. Open an explicit localhost URL to choose one.",
        );
      }
      if (worktrees.length === 1) folder = worktrees[0]![0];
    }
    const env = await this.env(chat, folder);
    const configured =
      settings?.devPort && !remote
        ? worktreeDevPort(settings.devPort, env)
        : undefined;
    const ports = live.get(folder) ?? [];
    const select = (ports: number[]) =>
      configured && ports.includes(configured)
        ? configured
        : ports.length === 1
          ? ports[0]
          : undefined;
    const port = remote
      ? undefined
      : (requested ??
        select(ports) ??
        (ports.length === 0 ? configured : undefined));
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
      ...(url ? { url } : {}),
      settings: {
        devCommand: settings?.devCommand,
        devPort: settings?.devPort,
      },
      ...(port
        ? {
            dev: {
              port,
              ...(sameSettings &&
              saved?.folder === folder &&
              saved.dev?.port === port &&
              saved.dev.command
                ? { command: saved.dev.command }
                : port === configured
                  ? { command: settings?.devCommand }
                  : {}),
            },
          }
        : {}),
    };
  }
}
