import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { ElsewhereChanges, ElsewhereGroup } from "../../shared/elsewhere";
import { liveAway } from "../../shared/handoff";
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

/** A file one of the threads changed: the lead's own (`by` null) or a started one's. */
interface Touched {
  root: string;
  path: string;
  by: string | null;
}

/** What a thread and those it started touched, as last read from them. */
interface Reading {
  /** The started threads it read, reviewers left out. */
  started: string[];
  /** `touchMark` of each thread read, so a save that changes none of it keeps the reading. */
  marks: Map<string, string>;
  read: Promise<{ own: string | null; touches: Touched[] }>;
}

/** Threads whose readings are kept, the least recently read let go first. */
const KEPT_READINGS = 50;

const touches = (chat: ProjectChat) =>
  chat.messages.some((m) => m.changes?.length || m.elsewhere?.length);

/**
 * Changes whenever what `touched` reads of a thread does: its folder, and the
 * files its turns changed, here or elsewhere, and rolled back.
 */
export function touchMark(chat: ProjectChat) {
  const parts = [
    chat.worktree?.path ?? "",
    String(chat.worktree?.removedAt ?? ""),
    JSON.stringify(chat.activeAgentWorktree ?? null),
  ];
  for (const m of chat.messages) {
    const changed = m.changes?.length ?? 0;
    const elsewhere = (m.elsewhere ?? []).reduce(
      (n, e) => n + e.paths.length,
      0,
    );
    if (!changed && !elsewhere) continue;
    const reverted = (m.changes ?? []).filter((f) => f.revertedBy).length;
    parts.push(`${m.id}:${changed}:${reverted}:${elsewhere}`);
  }
  return parts.join("|");
}

/**
 * Files a thread and the threads it started changed, in its own repository
 * and others: in the thread's own one only what the started ones changed,
 * since the Changes list shows the rest already.
 *
 * What they touched is read from their saved turns once and kept until one
 * of them is saved with other turns or folder, or the started threads
 * change, so the Changes pane asking again loads no thread and runs Git only
 * for what is uncommitted.
 */
export function elsewhereHandlers(ctx: ApiContext) {
  const { projectChats, store } = ctx;
  const folderOf = (chat: ProjectChat) =>
    projectChats.terminalFolder(chat.projectId, chat.id).catch(() => null);
  const readings = new Map<string, Reading>();

  /** A thread's reading no longer holds: its window reads it again. */
  function changed(chatId: string) {
    readings.delete(chatId);
    ctx.window.send("relay:elsewhere", chatId);
  }
  projectChats.onSaved((chat) => {
    for (const [lead, reading] of [...readings]) {
      const was = reading.marks.get(chat.id);
      if (
        was !== undefined
          ? was !== touchMark(chat)
          : // One it started since, once that touched something.
            chat.startedBy?.chatId === lead && touches(chat)
      )
        changed(lead);
    }
  });

  const filesAway = (chatId: string) => {
    const chat = store.get().chats?.find((c) => c.id === chatId);
    return !!chat && liveAway(chat) && !!chat.sentTo?.folder;
  };

  // A started thread can't start threads of its own.
  const startedBy = (chatId: string) =>
    projectChats.startedThreads(chatId).filter((c) => !c.reviewer);

  async function read(
    chatId: string,
    started: string[],
    marks: Reading["marks"],
  ) {
    const chat = await projectChats.get(chatId);
    marks.set(chat.id, touchMark(chat));
    const ownFolder = await folderOf(chat);
    const own = (ownFolder && (await topLevel(ownFolder))) || null;
    const touched: Touched[] = [];
    for (const m of chat.messages)
      for (const e of m.elsewhere ?? [])
        for (const p of e.paths)
          touched.push({ root: e.root, path: p, by: null });
    for (const id of started) {
      const child = await projectChats.get(id).catch(() => null);
      if (!child) continue;
      marks.set(child.id, touchMark(child));
      const folder = await folderOf(child);
      const top = folder && (await topLevel(folder));
      // Turn changes are relative to the thread's folder, which may sit below its repository's top.
      const prefix = top && folder ? relative(top, resolve(folder)) : "";
      for (const m of child.messages) {
        if (top)
          for (const f of m.changes ?? [])
            if (!f.revertedBy)
              touched.push({
                root: top,
                path: prefix
                  ? `${prefix.split(sep).join("/")}/${f.path}`
                  : f.path,
                by: child.id,
              });
        for (const e of m.elsewhere ?? [])
          for (const p of e.paths)
            touched.push({ root: e.root, path: p, by: child.id });
      }
    }
    return { own, touches: touched };
  }

  /** The reading of what `chatId` and the threads it started touched, read again only once it changed. */
  function reading(chatId: string) {
    const started = startedBy(chatId);
    // Listed most recently updated first; which ones, not their order, counts.
    const ids = started.map((c) => c.id);
    const sorted = [...ids].sort();
    let kept = readings.get(chatId);
    if (
      kept &&
      (kept.started.length !== sorted.length ||
        kept.started.some((id, i) => id !== sorted[i]))
    )
      kept = undefined;
    if (kept) {
      // Read lately: let go of last.
      readings.delete(chatId);
      readings.set(chatId, kept);
    } else {
      const marks = new Map<string, string>();
      const fresh: Reading = {
        started: sorted,
        marks,
        read: read(chatId, ids, marks),
      };
      kept = fresh;
      readings.set(chatId, fresh);
      for (const old of readings.keys()) {
        if (readings.size <= KEPT_READINGS) break;
        readings.delete(old);
      }
      fresh.read.then(
        ({ own, touches }) =>
          // Windows showing it watch the repositories it touched now.
          void ctx.elsewhereWatch
            ?.roots(chatId, otherRoots(own, touches))
            .catch(() => {}),
        () => {
          if (readings.get(chatId) === fresh) readings.delete(chatId);
        },
      );
    }
    return { started, read: kept.read };
  }

  const otherRoots = (own: string | null, touched: Touched[]) => [
    ...new Set(touched.map((t) => t.root).filter((r) => r !== own)),
  ];

  async function touched(chatId: string) {
    const { started, read } = reading(chatId);
    const { own, touches } = await read;
    const titles = new Map(started.map((c) => [c.id, c.title || "Untitled"]));
    const repos = new Map<string, Map<string, Touch>>();
    for (const { root, path, by } of touches) {
      const files = repos.get(root) ?? new Map<string, Touch>();
      repos.set(root, files);
      const t = files.get(path) ?? { own: false, by: new Map() };
      files.set(path, t);
      if (by) t.by.set(by, titles.get(by) ?? "Untitled");
      else t.own = true;
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
    watchElsewhere: takes([idSchema.nullable()], async (chatId) => {
      const owner = ctx.window.caller();
      const watch = ctx.elsewhereWatch;
      if (!owner || !watch) return false;
      watch.show(owner, chatId);
      // Live on another computer, its files are there: the window polls.
      if (chatId === null || !watch.watches || filesAway(chatId)) return false;
      const { own, touches } = await reading(chatId).read;
      // It asked for another thread's while this one was read.
      if (!watch.showing(owner, chatId)) return false;
      return watch.roots(chatId, otherRoots(own, touches));
    }),
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
