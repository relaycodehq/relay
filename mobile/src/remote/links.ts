import { matchLink, projectFileLink } from "../../../shared/project-file-links";
import type { TurnFileChange } from "../../../shared/projects";
import type { RemoteDiffSource } from "../../../shared/remote";

/** A file's diff: a turn's, the working tree's, a commit's or a worktree's. */
export const diffHref = (source: RemoteDiffSource) =>
  ({ pathname: "/diff", params: { source: JSON.stringify(source) } }) as const;

/** A file as it is on disk, read-only. */
export const fileHref = (where: string, path: string) =>
  ({ pathname: "/file", params: { where, path } }) as const;

/** The Files list, opened at a folder. */
export const folderHref = (where: string, dir: string) =>
  ({ pathname: "/files", params: { where, dir } }) as const;

/** Where Git and file calls work: the project's checkout, or a thread's worktree (shared/workspaces). */
export const workspaceId = (projectId: string, chatId?: string) =>
  chatId ? `${projectId}/${chatId}` : projectId;

export type FileLinkTarget =
  | { kind: "diff"; change: TurnFileChange }
  | { kind: "file" | "folder"; path: string };

/**
 * What a link or inline code in an answer opens: the diff of a file the
 * answer's turn changed, else the file or folder as it is. Paths outside
 * `root` stay text. A bare `cache.ts:33` opens the one change it names.
 */
export function fileLinkTarget(
  value: string,
  inline: boolean,
  root: string,
  changes: readonly TurnFileChange[] = [],
): FileLinkTarget | null {
  const link = projectFileLink(value, root, inline);
  if (!link) return null;
  if (link.directory) return { kind: "folder", path: link.path };
  const changed = matchLink(
    link,
    changes.map((c) => c.path),
  );
  const change =
    changed.length === 1
      ? changes.find((c) => c.path === changed[0])
      : undefined;
  return change ? { kind: "diff", change } : { kind: "file", path: link.path };
}
