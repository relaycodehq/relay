import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  linkedFoldersSchema,
  linkName,
  threadLinks,
  tildePath,
  type ChatSummary,
  type LinkedFolder,
  type Project,
} from "../../../shared/projects";
import { threadStorage } from "../../lib/thread-storage";
import { api } from "../../lib/api";
import { useStableCallback } from "../../lib/useStableCallback";
import { useSteady } from "../../lib/useSteady";
import { useAddDir } from "./useAddDir";

export type ThreadLinks = ReturnType<typeof useThreadLinks>;

/** No links, one array for all, so a thread without any keeps the same list. */
const NONE: LinkedFolder[] = [];

type SavedLinks = { id: string; links: LinkedFolder[] };

/** The thread's own links: the save in flight, the thread's, or the unsent one's. */
function ownLinks(
  chat: ChatSummary | undefined,
  pending: SavedLinks | undefined,
  draft: SavedLinks,
  draftId: string,
): LinkedFolder[] {
  if (!chat) return draft.id === draftId ? draft.links : NONE;
  if (pending?.id === chat.id) return pending.links;
  return chat.links ?? NONE;
}

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
  const [pending, setPending] = useState<SavedLinks>();
  useEffect(() => setPending(undefined), [chat?.links]);
  const own = ownLinks(chat, pending, draft, draftId);
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
  const links = useMemo(
    () => threadLinks(project.settings?.links, own, project.path),
    [project.settings?.links, own, project.path],
  );

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

  const linkFolder = useStableCallback((path: string) =>
    enqueue(() => link(path)),
  );
  const { options, command, listed } = useAddDir({
    project,
    links,
    link: linkFolder,
    onError,
  });

  const change = useStableCallback(
    async (path: string, next: Partial<LinkedFolder>) => {
      await enqueue(() =>
        save(
          current.current.map((l) => (l.path === path ? { ...l, ...next } : l)),
        ),
      );
    },
  );
  const unlink = useStableCallback(async (path: string) => {
    await enqueue(() => save(current.current.filter((l) => l.path !== path)));
  });

  return useSteady({
    links,
    /** Goes up as each listing `/add-dir` asked for arrives. */
    listed,
    /** What the unsent thread is made with. */
    draftLinks: chat ? undefined : own,
    link: linkFolder,
    change,
    unlink,
    /** Moves a thread's link to its project, so every thread reaches it. */
    linkToProject: useStableCallback((path: string) =>
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
    ),
    /** `/add-dir`, typed or picked from its menu. */
    command,
    /** What `/add-dir` offers for what's typed after it. */
    options,
  });
}
