// What an agent offers to import from another app's history (its offer_import
// tool), left in its answer for the user to tick through and import.
import { z } from "zod";
import type { ImportApp, ImportChat } from "./project-import";
import type { Project } from "./projects";
import { moveProjectInList, projectFolderSchema } from "./project-folders";

export interface ImportOfferProject {
  /** The source project's key, as ProjectImports lists it. */
  key: string;
  name: string;
  path: string;
  /** Already a Relay project: it keeps its place, only chats come in. */
  projectId?: string;
  /** The sidebar group the agent put it in; "" for none. */
  group: string;
  /** Every chat the source has for it; `chatId` marks those already in Relay. */
  chats: ImportChat[];
  /** The chats the agent ticked. */
  picked: string[];
}

export interface ImportOfferResult {
  at: number;
  /** Chats that came in, by source project key; a key with none is a project added on its own. */
  imported: Record<string, string[]>;
  failures: { key: string; chatId?: string; message: string }[];
}

export interface ImportOffer {
  id: string;
  app: ImportApp;
  /** In the order the agent wants them in the sidebar. */
  projects: ImportOfferProject[];
  done?: ImportOfferResult;
}

/** Projects picked to import, each with the chats ticked; a project left out isn't imported. */
export type ImportPicks = Record<string, string[]>;

/** The sidebar row a project not yet imported stands in for. */
export const ghostId = (key: string) => `import:${key}`;
export const ghostKey = (id: string) =>
  id.startsWith("import:") ? id.slice(7) : undefined;

/** Where one imported project goes: its group, and the project it sits above, by real id or ghostId. */
export const importPlacementSchema = z
  .object({
    key: z.string().min(1).max(100),
    group: projectFolderSchema,
    before: z.string().min(1).max(200).nullable(),
  })
  .strict();
export type ImportPlacement = z.infer<typeof importPlacementSchema>;

export const runImportOfferSchema = z
  .object({
    picks: z.record(
      z.string().max(100),
      z.array(z.string().max(200)).max(10000),
    ),
    placements: z.array(importPlacementSchema).max(1000),
  })
  .strict();
export type RunImportOffer = z.infer<typeof runImportOfferSchema>;

/** The chats of a project the offer can still bring in. */
export const freshChats = (p: ImportOfferProject) =>
  p.chats.filter((c) => !c.chatId);

/** What the agent ticked, before the user changes anything. */
export const offeredPicks = (offer: ImportOffer): ImportPicks =>
  Object.fromEntries(
    offer.projects
      .filter((p) => !p.projectId || p.picked.length)
      .map((p) => [p.key, p.picked]),
  );

/**
 * The sidebar's projects with the offer's new ones among them, as stand-ins
 * the user drags about: each in its group, above what `order` says follows
 * it. `order` lists real and stand-in ids as the sidebar last showed them;
 * a stand-in it doesn't list ends its group.
 */
export function withGhosts<T extends Pick<Project, "id" | "folder">>(
  real: T[],
  ghosts: T[],
  order: { id: string; folder?: string }[],
): T[] {
  let list = [...real];
  const byId = new Map(ghosts.map((g) => [g.id, g]));
  // Last first, so a stand-in's neighbour below is already in place.
  for (let i = order.length - 1; i >= 0; i--) {
    const ghost = byId.get(order[i]!.id);
    if (!ghost) continue;
    const folder = ghost.folder ?? "";
    const before =
      order
        .slice(i + 1)
        .find((n) =>
          list.some((p) => p.id === n.id && (p.folder ?? "") === folder),
        )?.id ?? null;
    list = moveProjectInList([...list, ghost], ghost.id, folder, before);
  }
  // One ticked again since the last move wasn't listed then: it ends its group.
  for (const ghost of ghosts)
    if (!order.some((n) => n.id === ghost.id))
      list = moveProjectInList(
        [...list, ghost],
        ghost.id,
        ghost.folder ?? "",
        null,
      );
  return list;
}

/** Where each stand-in in `list` lands: its group and what sits right below it there. */
export function placementsOf(
  list: Pick<Project, "id" | "folder">[],
): ImportPlacement[] {
  return list.flatMap((p, i) => {
    const key = ghostKey(p.id);
    if (!key) return [];
    const group = p.folder ?? "";
    const below = list.slice(i + 1).find((n) => (n.folder ?? "") === group);
    return [{ key, group, before: below?.id ?? null }];
  });
}
