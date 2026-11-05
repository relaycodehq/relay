import { useCallback, useReducer } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CommandOption, RelayCommand } from "../../../shared/commands";
import {
  linkName,
  tildePath,
  type FolderEntry,
  type LinkedFolder,
  type LinkSuggestion,
  type Project,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import { fileManager } from "../../lib/mod-key";
import { useStableCallback } from "../../lib/useStableCallback";

/** The `/add-dir` option that opens the system's folder picker. */
const CHOOSE = ":choose";

/** What the query cache holds for a key, fetching it when it holds nothing. */
type Cached = <T>(key: unknown[], load: () => Promise<T>) => T | undefined;

/**
 * What the query cache holds for a key, fetched once when it holds nothing;
 * `listed` goes up as each arrives.
 */
function useListing() {
  const qc = useQueryClient();
  const [listed, bump] = useReducer((n: number) => n + 1, 0);
  const cached = useCallback(
    <T>(key: unknown[], load: () => Promise<T>): T | undefined => {
      const state = qc.getQueryState<T>(key);
      if (!state)
        void qc
          .query({ queryKey: key, queryFn: load, staleTime: 30_000 })
          .catch(() => undefined)
          .then(bump);
      return state?.data;
    },
    [qc],
  );
  return { cached, listed };
}

/** What a repository in the list is to this thread. */
function repositoryNote(path: string, projectPath: string, taken: Set<string>) {
  if (path === projectPath) return "This project";
  if (taken.has(path)) return "Linked already";
  return "Repository";
}

/** A typed path: what's in the folder it names so far. */
function pathOptions(
  query: string,
  taken: Set<string>,
  projectPath: string,
  cached: Cached,
): CommandOption[] {
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
            description: repositoryNote(f.path, projectPath, taken),
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

/**
 * `/add-dir`: linking the folder typed or picked, and what it offers for
 * what's typed after it: folders beside the project and other projects, or
 * what's in a typed path so far. Listings are fetched as the menu asks for
 * them; `listed` goes up as each arrives.
 */
export function useAddDir({
  project,
  links,
  link,
  onError,
}: {
  project: Project;
  links: LinkedFolder[];
  /** Links a folder; an error says why it can't. */
  link: (path: string) => Promise<string | undefined>;
  onError: (error: unknown) => void;
}) {
  const { cached, listed } = useListing();

  const command = useStableCallback(function command(
    command: RelayCommand,
    args: string,
  ): boolean | string | undefined {
    if (command !== "add-dir") return undefined;
    const typed = args.trim();
    if (!typed) return "Type a folder after /add-dir, or pick one.";
    void (async () => {
      const path =
        typed === CHOOSE ? await api.chooseFolder("Link a folder") : typed;
      if (!path) return;
      const problem = await link(path);
      if (problem) onError(new Error(problem));
    })().catch(onError);
    return true;
  });

  // The menu calls it as it renders, so it changes with what it reads.
  const options = useCallback(
    function options(
      command: RelayCommand,
      query: string,
    ): CommandOption[] | undefined {
      if (command !== "add-dir") return undefined;
      const taken = new Set([project.path, ...links.map((l) => l.path)]);
      if (/^[~/]/.test(query))
        return pathOptions(query, taken, project.path, cached);
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
          source: fileManager,
          folder: true,
        },
      ];
    },
    [links, project.id, project.path, cached],
  );

  return { options, command, listed };
}
