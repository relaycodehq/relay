import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { RootContent } from "mdast";
import type { ProjectChat } from "../../shared/projects";
import { projectTasks } from "../terminal/tasks";
import { currentBranchOr } from "../git/git";
import { LocalUrls, localPort, type LocalPreview } from "./local-urls";
import { runningServerPorts } from "./running-server";

/** Change clickable destinations, leaving code examples and other prose intact. */
export async function nameLocalLinks(
  body: string,
  name: (url: string) => Promise<string | undefined>,
) {
  const tree = fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const edits: { start: number; end: number; value: string }[] = [];
  const urls = new Map<string, Promise<string | undefined>>();
  const visit = async (node: RootContent): Promise<void> => {
    if (
      (node.type === "link" || node.type === "definition") &&
      localPort(node.url)
    ) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const source = body.slice(start, end);
      // For a Markdown link, the destination follows its label. Autolinks
      // and reference definitions have only one URL in their source span.
      const labelEnd =
        node.type === "link" && source.startsWith("[")
          ? (node.children.at(-1)?.position?.end.offset ?? start) - start
          : 0;
      const offset = source.indexOf(node.url, labelEnd);
      if (offset < 0) return;
      let pending = urls.get(node.url);
      if (!pending) urls.set(node.url, (pending = name(node.url)));
      const named = await pending;
      if (named && named !== node.url)
        edits.push({
          start: start + offset,
          end: start + offset + node.url.length,
          value: named,
        });
      return;
    }
    if ("children" in node) await Promise.all(node.children.map(visit));
  };
  await Promise.all(tree.children.map(visit));
  for (const edit of edits.sort((a, b) => b.start - a.start))
    body = body.slice(0, edit.start) + edit.value + body.slice(edit.end);
  return body;
}

export interface ServerLinkFolders {
  project: string;
  root: string;
  worktrees: { path: string; chatId: string }[];
  /** Only these folders belong to this thread; others classify neighbours. */
  allowed: string[];
}

/** Named routes for processes, independent of browser renderers. */
export class ServerLinks {
  constructor(
    private urls: LocalUrls,
    private folders: (chat: ProjectChat) => Promise<ServerLinkFolders>,
    private wake?: (
      chat: ProjectChat,
      folder: string,
      port: number,
    ) => Promise<unknown>,
  ) {}

  private async discover(chat: ProjectChat) {
    const { project, root, worktrees, allowed } = await this.folders(chat);
    const tasks = await projectTasks.list(root, worktrees, {
      fresh: true,
      includeNewServers: true,
    });
    const servers: LocalPreview[] = [];
    for (const folder of new Set(
      tasks
        .map((t) => t.folder)
        .filter((s): s is string => !!s && allowed.includes(s)),
    )) {
      const ports = await runningServerPorts(
        tasks.filter((t) => t.folder === folder),
      );
      if (!ports.length) continue;
      for (const port of ports)
        servers.push(
          await this.makeRoute(
            chat,
            { project, root, worktrees },
            folder,
            port,
          ),
        );
    }
    return servers;
  }

  /** Browser links and answer links use the same service names and wake logic. */
  async route(chat: ProjectChat, folder: string, port: number) {
    const scope = await this.folders(chat);
    if (!scope.allowed.includes(folder))
      throw new Error("This server folder doesn't belong to this thread.");
    return this.makeRoute(chat, scope, folder, port);
  }

  private async makeRoute(
    chat: ProjectChat,
    scope: Omit<ServerLinkFolders, "allowed">,
    folder: string,
    port: number,
  ) {
    const branch =
      folder === scope.root
        ? undefined
        : await currentBranchOr(folder, "worktree");
    const route: LocalPreview = {
      folder,
      project: scope.project,
      branch,
      port,
      wake: async () => {
        // A new listener in the same folder is not proof of the same service.
        await this.wake?.(chat, folder, port);
      },
    };
    return route;
  }

  async note(chat: ProjectChat) {
    const servers = await this.discover(chat);
    if (!servers.length) return;
    const links = await Promise.all(
      servers.map(
        async (server) =>
          `${JSON.stringify(server.folder)} · localhost:${server.port} → ${await this.urls.url(server)}`,
      ),
    );
    return `Relay browser links for HTTP servers already running in this thread's folders. Use these named URLs in links you share with the user; keep the page path, query and fragment. Direct localhost still works for commands and the preview tools.\n${links.join("\n")}`;
  }

  async answer(chat: ProjectChat, body: string) {
    // Avoid scanning every process for ordinary answers without local links.
    if (!/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i.test(body))
      return body;
    let discovered: Promise<LocalPreview[]> | undefined;
    return nameLocalLinks(body, async (url) => {
      const port = localPort(url);
      const servers = await (discovered ??= this.discover(chat));
      const matches = servers.filter((server) => server.port === port);
      if (matches.length !== 1) return;
      const destination = new URL(await this.urls.url(matches[0]!));
      const source = new URL(url);
      destination.pathname = source.pathname;
      destination.search = source.search;
      destination.hash = source.hash;
      return destination.href;
    });
  }
}
