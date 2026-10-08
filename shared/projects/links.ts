import { z } from "zod";

/**
 * Linked folders: other repositories a project's agents may reach beyond
 * their own folder, like the backend or shared types. A project's links go to
 * every thread in it; `/add-dir` links one to a single thread.
 */
export const linkAccessSchema = z.enum(["read", "write"]);
export type LinkAccess = z.infer<typeof linkAccessSchema>;

const absolutePath = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(
    (v) =>
      (v.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(v)) && !v.includes("\0"),
    "Link a folder by its full path.",
  )
  .transform((v) => (v.length > 1 ? v.replace(/[\\/]+$/, "") : v));

export const linkedFolderSchema = z
  .object({
    path: absolutePath,
    /** What's in there, in a line the agent is told. */
    note: z.string().trim().max(300).optional(),
    access: linkAccessSchema,
  })
  .strict();
export type LinkedFolder = z.infer<typeof linkedFolderSchema>;

export const linkedFoldersSchema = z
  .array(linkedFolderSchema)
  .max(20, "Link up to 20 folders.")
  .refine(
    (links) => new Set(links.map((l) => l.path)).size === links.length,
    "That folder is linked already.",
  );

/** A linked folder as a thread sees it: where the link comes from. */
export type ThreadLink = LinkedFolder & { from: "project" | "thread" };

/**
 * What a thread reaches: its project's links, then its own. A folder linked
 * both ways takes the thread's access and note. The thread's own folder is
 * never a link.
 */
export function threadLinks(
  project: readonly LinkedFolder[] | undefined,
  thread: readonly LinkedFolder[] | undefined,
  own?: string,
): ThreadLink[] {
  const mine = new Map((thread ?? []).map((l) => [l.path, l]));
  return [
    ...(project ?? [])
      .filter((l) => !mine.has(l.path))
      .map((l) => ({ ...l, from: "project" as const })),
    ...[...mine.values()].map((l) => ({ ...l, from: "thread" as const })),
  ].filter((l) => l.path !== own);
}

/** `/Users/me/work` → `~/work`. */
export const tildePath = (path: string) =>
  path.replace(/^\/(Users|home)\/[^/]+/, "~");

export const linkName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** What the agent is told about its linked folders, or nothing without any. */
export function linksInstructions(links: readonly LinkedFolder[]) {
  if (!links.length) return "";
  const line = (l: LinkedFolder) =>
    `- ${l.path} (${l.access === "write" ? "read and write" : "read only"})${l.note ? `: ${l.note}` : ""}`;
  const writes = links.some((l) => l.access === "write");
  return [
    "Linked folders: the user linked these folders outside your working directory for you to use. Read and search them with absolute paths when the task touches them.",
    ...links.map(line),
    writes
      ? "Edit a read-only one only if the user asks. Edits in a linked folder land in that folder itself, outside this thread's worktree and its review."
      : "Don't edit them unless the user asks.",
  ].join("\n");
}
