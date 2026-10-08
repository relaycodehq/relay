import { useEffect, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CommandOption, RelayCommand } from "../../../shared/commands";
import {
  linkedFoldersSchema,
  linkName,
  threadLinks,
  tildePath,
  type ChatSummary,
  type FolderEntry,
  type LinkedFolder,
  type LinkSuggestion,
  type Project,
} from "../../../shared/projects";
import { threadStorage } from "../../lib/thread-storage";
import { api } from "../../lib/api";

export type ThreadLinks = ReturnType<typeof useThreadLinks>;

/** The `/add-dir` option that opens the system's folder picker. */
const CHOOSE = ":choose";

/**
 * The folders a thread reaches beyond its project: the project's links and
 * its own. An unsent thread holds its own until its first write makes it;
 * `/add-dir` links one, completing paths as they're typed.
 */
export function useThreadLinks({
  project,
  chat,
  draftId,
  onError,
}: {
  project: Project;
  chat?: ChatSummary;
  draftId: string;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(() => ({
    id: draftId,
    links: threadStorage(draftId).links.load(),
  }));
  // Shown at once; the thread list catches up after the save.
  const [pending, setPending] = useState<{
    id: string;
    links: LinkedFolder[];
  }>();
  useEffect(() => setPending(undefined), [chat?.links]);
  const own = chat
    ? pending?.id === chat.id
      ? pending.links
      : (chat.links ?? [])
    : draft?.id === draftId
      ? draft.links
      : [];
  const current = useRef(own);
  current.current = own;
  const queue = useRef(Promise.resolve());
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.current.then(work);
    queue.current = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  const links = threadLinks(project.settings?.links, own, project.path);
  // Folder listings for completing a typed path; fetched as the query asks for them.
  const [, bump] = useReducer((n: number) => n + 1, 0);

  async function save(next: LinkedFolder[]) {
    next = linkedFoldersSchema.parse(next);
    if (!chat) {
      threadStorage(draftId).links.save(next);
      current.current = next;
      setDraft({ id: draftId, links: next });
      return;
    }
    setPending({ id: chat.id, links: next });
    try {
      const saved = await api.setProjectChatLinks(chat.id, next);
      current.current = saved.links ?? [];
      qc.setQueriesData<ChatSummary[]>(
        { queryKey: ["project-chats"] },
        (list) => list?.map((c) => (c.id === saved.id ? saved : c)),
      );
    } catch (e) {
      setPending(undefined);
      onError(e);
    }
  }

  /** Links a folder to this thread, read only; an error says why it can't. */
  async function link(path: string): Promise<string | undefined> {
    const info = await api.inspectFolder(path);
    if (info.kind === "missing") return `${tildePath(info.path)} isn't there.`;
    if (info.kind === "file")
      return `${linkName(info.path)} is a file, not a folder.`;
    if (info.path === project.path)
      return `That's ${project.name}'s own folder.`;
    if (
      threadLinks(project.settings?.links, current.current, project.path).some(
        (l) => l.path === info.path,
      )
    )
      return `${linkName(info.path)} is linked already.`;
    await save([...current.current, { path: info.path, access: "read" }]);
  }

  return {
    links,
    /** What the unsent thread is made with. */
    draftLinks: chat ? undefined : own,
    link: (path: string) => enqueue(() => link(path)),
    async change(path: string, next: Partial<LinkedFolder>) {
      await enqueue(() =>
        save(
          current.current.map((l) => (l.path === path ? { ...l, ...next } : l)),
        ),
      );
    },
    async unlink(path: string) {
      await enqueue(() => save(current.current.filter((l) => l.path !== path)));
    },
    /** Moves a thread's link to its project, so every thread reaches it. */
    linkToProject: (path: string) =>
      enqueue(async () => {
        const moving = current.current.find((l) => l.path === path);
        if (!moving) return;
        try {
          let saved: Project;
          if (chat) {
            const result = await api.promoteProjectChatLink(chat.id, path);
            saved = result.project;
            current.current = result.chat.links ?? [];
            setPending({ id: chat.id, links: result.chat.links ?? [] });
            qc.setQueriesData<ChatSummary[]>(
              { queryKey: ["project-chats"] },
              (list) =>
                list?.map((c) => (c.id === result.chat.id ? result.chat : c)),
            );
          } else {
            saved = await api.addProjectLinks(project.id, [moving]);
            await save(current.current.filter((l) => l.path !== path));
          }
          qc.setQueriesData<Project[]>({ queryKey: ["projects"] }, (list) =>
            list?.map((p) =>
              p.id === project.id ? { ...p, settings: saved.settings } : p,
            ),
          );
        } catch (e) {
          onError(e);
        }
      }),
    /** `/add-dir`, typed or picked from its menu. */
    command(command: RelayCommand, args: string): boolean | string | undefined {
      if (command !== "add-dir") return undefined;
      const typed = args.trim();
      if (!typed) return "Type a folder after /add-dir, or pick one.";
      void (async () => {
        const path =
          typed === CHOOSE ? await api.chooseFolder("Link a folder") : typed;
        if (!path) return;
        const problem = await enqueue(() => link(path));
        if (problem) onError(new Error(problem));
      })().catch(onError);
      return true;
    },
    /** What `/add-dir` offers for what's typed after it. */
    options(command: RelayCommand, query: string): CommandOption[] | undefined {
      if (command !== "add-dir") return undefined;
      const taken = new Set([project.path, ...links.map((l) => l.path)]);
      if (/^[~/]/.test(query)) return pathOptions(query, taken);
      const suggestions = cached<LinkSuggestion[]>(
        ["link-suggestions", project.id],
        () => api.linkSuggestions(project.id),
      );
      const words = query.toLowerCase();
      return [
        ...(suggestions ?? [])
          .filter((s) => !taken.has(s.path))
          .map((s) => ({
            value: s.path,
            label: s.project ?? linkName(s.path),
            description: tildePath(s.path),
            source: s.project ? "Project" : "Beside it",
            folder: true,
          }))
          .filter(
            (o) =>
              o.label.toLowerCase().includes(words) ||
              o.description.toLowerCase().includes(words),
          ),
        {
          value: CHOOSE,
          label: "Choose a folder…",
          description: "Or type a path, like ~/work/",
          source: "Finder",
          folder: true,
        },
      ];
    },
  };

  /** What the query cache holds for `key`, fetching it once when it holds nothing. */
  function cached<T>(key: unknown[], load: () => Promise<T>): T | undefined {
    const state = qc.getQueryState<T>(key);
    if (!state)
      void qc
        .fetchQuery({ queryKey: key, queryFn: load, staleTime: 30_000 })
        .catch(() => undefined)
        .then(bump);
    return state?.data;
  }

  /** A typed path: what's in the folder it names so far. */
  function pathOptions(query: string, taken: Set<string>): CommandOption[] {
    const cut = query.lastIndexOf("/");
    const dir = cut < 0 ? query : query.slice(0, cut + 1);
    const leaf = cut < 0 ? "" : query.slice(cut + 1).toLowerCase();
    const listing = cached<FolderEntry[]>(["folder-listing", dir], () =>
      api.listFolders(dir).catch(() => []),
    );
    if (!listing) return [];
    const options: CommandOption[] = listing
      .filter((f) => f.name.toLowerCase().startsWith(leaf))
      .slice(0, 40)
      .map((f) =>
        f.repository || taken.has(f.path)
          ? {
              value: f.path,
              label: tildePath(f.path),
              description:
                f.path === project.path
                  ? "This project"
                  : taken.has(f.path)
                    ? "Linked already"
                    : "Repository",
              source: "Disk",
              folder: true,
            }
          : {
              value: f.path,
              label: `${tildePath(f.path)}/`,
              description: "Folder",
              source: "Disk",
              fill: `/add-dir ${tildePath(f.path)}/`,
            },
      );
    // `~/work/` itself, before what's in it.
    if (!leaf && dir.length > 1)
      options.unshift({
        value: dir,
        label: dir,
        description: "This folder",
        source: "Disk",
        folder: true,
      });
    return options;
  }
}
