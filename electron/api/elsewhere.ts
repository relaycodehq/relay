import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type {
  ElsewhereAuthor,
  ElsewhereChanges,
  ElsewhereGroup,
} from "../../shared/elsewhere";
import type { ProjectChat } from "../../shared/projects";
import { idSchema } from "../../shared/validation";
import { workingPathSchema } from "../../shared/working-tree";
import { topLevel, uncommitted } from "../git/elsewhere";
import { headDiff, performGitAction } from "../git/working-tree";
import { takes, type ApiContext } from "./context";

const rootSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => isAbsolute(p), "Not a folder path");

interface Touch {
  own: boolean;
  by: Map<string, string>;
}

/**
 * Files a thread and the threads it started changed, in its own repository
 * and others: in the thread's own one only what the started ones changed,
 * since the Changes list shows the rest already.
 */
export function elsewhereHandlers(ctx: ApiContext) {
  const { projectChats, store } = ctx;
  const folderOf = (chat: ProjectChat) =>
    projectChats.terminalFolder(chat.projectId, chat.id).catch(() => null);

  async function touched(chatId: string) {
    const chat = await projectChats.get(chatId);
    const ownFolder = await folderOf(chat);
    const own = ownFolder && (await topLevel(ownFolder));
    const repos = new Map<string, Map<string, Touch>>();
    const add = (
      root: string,
      path: string,
      author: ElsewhereAuthor | null,
    ) => {
      const files = repos.get(root) ?? new Map<string, Touch>();
      repos.set(root, files);
      const t = files.get(path) ?? { own: false, by: new Map() };
      files.set(path, t);
      if (author) t.by.set(author.chatId, author.title);
      else t.own = true;
    };
    for (const m of chat.messages)
      for (const e of m.elsewhere ?? [])
        for (const p of e.paths) add(e.root, p, null);
    // A started thread can't start threads of its own.
    const started = projectChats
      .startedThreads(chatId)
      .filter((c) => !c.reviewer);
    for (const summary of started) {
      const child = await projectChats.get(summary.id).catch(() => null);
      if (!child) continue;
      const author = { chatId: child.id, title: child.title || "Untitled" };
      const folder = await folderOf(child);
      const top = folder && (await topLevel(folder));
      // Turn changes are relative to the thread's folder, which may sit below its repository's top.
      const prefix = top && folder ? relative(top, resolve(folder)) : "";
      for (const m of child.messages) {
        if (top)
          for (const f of m.changes ?? [])
            if (!f.revertedBy)
              add(
                top,
                prefix ? `${prefix.split(sep).join("/")}/${f.path}` : f.path,
                author,
              );
        for (const e of m.elsewhere ?? [])
          for (const p of e.paths) add(e.root, p, author);
      }
    }
    return { own, repos };
  }

  const authors = (t: Touch) =>
    [...t.by].map(([chatId, title]) => ({ chatId, title }));

  async function changes(chatId: string): Promise<ElsewhereChanges> {
    const { own, repos } = await touched(chatId);
    const here: ElsewhereChanges["here"] = {};
    const projects = store.get().projects ?? [];
    const groups = await Promise.all(
      [...repos].map(async ([root, files]): Promise<ElsewhereGroup | null> => {
        if (root === own) {
          for (const [path, t] of files) if (t.by.size) here[path] = authors(t);
          return null;
        }
        // A repository since deleted, or one Git can't read, drops out.
        const now = await uncommitted(root, [...files.keys()]).catch(
          () => null,
        );
        if (!now?.files.length) return null;
        const project = projects.find((p) => !p.removed && p.path === root);
        return {
          root,
          name: project?.name ?? basename(root),
          branch: now.tree.branch,
          revision: now.tree.revision,
          files: now.files.map((f) => {
            const t = files.get(f.path)!;
            return { ...f, own: t.own, by: authors(t) };
          }),
        };
      }),
    );
    return {
      groups: groups
        .filter((g): g is ElsewhereGroup => !!g)
        .sort((a, b) => a.name.localeCompare(b.name)),
      here,
    };
  }

  /** Only a file the thread's agents changed there, so the renderer can't reach any other. */
  async function owned(chatId: string, root: string, path?: string) {
    const { own, repos } = await touched(chatId);
    const files = root !== own ? repos.get(root) : undefined;
    if (!files || (path !== undefined && !files.has(path)))
      throw new Error("This thread's agents didn't change that file.");
    return files;
  }

  return {
    threadElsewhere: takes([idSchema], changes),
    threadElsewhereDiff: takes(
      [idSchema, rootSchema, workingPathSchema],
      async (chatId, root, path) => {
        await owned(chatId, root, path);
        return headDiff(root, path);
      },
    ),
    /** Commits the files the thread's agents changed in `root`, as they are on disk. */
    threadElsewhereCommit: takes(
      [
        idSchema,
        rootSchema,
        z.string().max(200),
        z.string().trim().min(1).max(16000),
      ],
      async (chatId, root, revision, message) => {
        const files = await owned(chatId, root);
        const now = await uncommitted(root, [...files.keys()]);
        if (!now.files.length)
          throw new Error("Nothing is left to commit there.");
        await performGitAction(root, {
          kind: "commit",
          revision,
          message,
          paths: now.files.map((f) => f.path),
        });
        return changes(chatId);
      },
    ),
  };
}
