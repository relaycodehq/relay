import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import type {
  ImportApp,
  ImportChat,
  ImportProject,
  ImportSelection,
  ProjectImportResult,
} from "../../shared/project-import";
import type { TerminalSessions } from "../terminal-sessions";
import type { ChatCore } from "./core";
import type { TerminalContinue } from "./terminal-continue";
import { errorMessage } from "../../shared/error-message";

const keyOf = (app: ImportApp, path: string) =>
  createHash("sha256").update(`${app}:${path}`).digest("hex");

/** One-time project imports. Discovery only reads; selections are revalidated before writes. */
export class ProjectImports {
  private running = false;

  constructor(
    private core: ChatCore,
    private sessions: TerminalSessions,
    private terminal: TerminalContinue,
  ) {}

  async list(app: ImportApp): Promise<ImportProject[]> {
    const folders = await this.sessions.projectFolders(app);
    const projects = this.core.store.get().projects ?? [];
    const seen = new Set<string>();
    const out: ImportProject[] = [];
    for (const folder of folders) {
      const canonical = await realpath(folder.path).catch(() => folder.path);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      const existing = projects.find((p) => !p.removed && p.path === canonical);
      out.push({
        key: keyOf(app, folder.path),
        name: folder.name,
        path: folder.path,
        missing: !(await stat(folder.path).then(
          (s) => s.isDirectory(),
          () => false,
        )),
        ...(existing ? { projectId: existing.id } : {}),
      });
    }
    return out.sort(
      (a, b) =>
        Number(a.missing) - Number(b.missing) || a.name.localeCompare(b.name),
    );
  }

  private async source(app: ImportApp, key: string) {
    const source = (await this.list(app)).find((p) => p.key === key);
    if (!source)
      throw new Error(
        "That project is no longer in the source app. Refresh the project list.",
      );
    return source;
  }

  async chats(
    app: ImportApp,
    key: string,
    folder?: string,
  ): Promise<ImportChat[]> {
    const source = await this.source(app, key);
    return this.sourceChats(app, source, folder);
  }

  /** A listed source's chats, without listing the sources again to find it. */
  async sourceChats(
    app: ImportApp,
    source: ImportProject,
    folder?: string,
  ): Promise<ImportChat[]> {
    const path = await realpath(folder ?? source.path).catch(
      () => folder ?? source.path,
    );
    const project = this.core.store
      .get()
      .projects?.find((p) => !p.removed && p.path === path);
    const imported = (this.core.store.get().chats ?? []).filter(
      (c) => c.projectId === project?.id,
    );
    return (await this.sessions.list(source.path, Infinity, app))
      .filter((s) => s.turns > 0)
      .map((s) => {
        const chatId = imported.find(
          (c) =>
            c.fromTerminal?.provider === app && c.fromTerminal.session === s.id,
        )?.id;
        return {
          id: s.id,
          title: s.title,
          updated: s.updated,
          turns: s.turns,
          ...(s.app ? { app: true as const } : {}),
          ...(chatId ? { chatId } : {}),
        };
      });
  }

  async run(
    app: ImportApp,
    selections: ImportSelection[],
  ): Promise<ProjectImportResult> {
    if (this.running)
      throw new Error("Another project import is still running.");
    this.running = true;
    const result: ProjectImportResult = { projects: [], failures: [] };
    try {
      // Resolve every key from source metadata, never a source path supplied by the renderer.
      const sources = new Map((await this.list(app)).map((p) => [p.key, p]));
      for (const selection of selections) {
        const source = sources.get(selection.key);
        if (!source)
          throw new Error(
            "A selected project is no longer in the source app. Refresh the project list.",
          );
      }
      for (const selection of selections) {
        const source = sources.get(selection.key)!;
        try {
          const available = new Set(
            selection.chats.length
              ? (await this.sourceChats(app, source, selection.folder)).map(
                  (c) => c.id,
                )
              : [],
          );
          // Do not add a project on behalf of a stale or forged session selection.
          if (selection.chats.some((id) => !available.has(id)))
            throw new Error(
              "A selected chat is no longer available. Refresh its chat list.",
            );
          const path = await realpath(selection.folder ?? source.path).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT")
                throw new Error(
                  `${source.name}'s folder is missing. Locate it before importing.`,
                );
              throw error;
            },
          );
          const existing = this.core.store
            .get()
            .projects?.find((p) => p.path === path);
          let project = await this.core.projects.add(path, null, {
            exact: true,
          });
          const name = source.name
            .replace(/[\x00-\x1f]/g, " ")
            .trim()
            .slice(0, 80);
          if (!existing && name && name !== project.name)
            project = await this.core.projects.rename(project.id, name);
          const imported: ProjectImportResult["projects"][number] = {
            key: source.key,
            project,
            chats: [],
          };
          result.projects.push(imported);
          for (const id of new Set(selection.chats)) {
            try {
              imported.chats.push(
                await this.terminal.continue(
                  project.id,
                  { provider: app, session: id },
                  "checkout",
                  undefined,
                  undefined,
                  source.path,
                ),
              );
            } catch (error) {
              result.failures.push({
                key: source.key,
                chatId: id,
                message: errorMessage(error),
              });
            }
          }
        } catch (error) {
          result.failures.push({
            key: source.key,
            message: errorMessage(error),
          });
        }
      }
      return result;
    } finally {
      this.running = false;
    }
  }
}
