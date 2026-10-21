// What the user makes of an agent's import offer before importing it: the
// ticks in its list, and where its new projects stand among the sidebar's.
// The open thread's offer shows in the sidebar as stand-in rows to drag.
import { useSyncExternalStore } from "react";
import {
  freshChats,
  ghostId,
  ghostKey,
  offeredPicks,
  withGhosts,
  type ImportOffer,
  type ImportPicks,
} from "../../../shared/import-offer";
import {
  moveProjectInList,
  rebaseGroup,
} from "../../../shared/project-folders";
import type { Project } from "../../../shared/projects";

export interface ImportPlan {
  key: string;
  offer: ImportOffer;
  picks: ImportPicks;
  /** The sidebar's order, stand-ins included, once the user moved something; until then each new project ends its group. */
  order?: { id: string; folder?: string }[];
}

const plans = new Map<string, ImportPlan>();
let shown: string | undefined;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const planKey = (chatId: string, offer: ImportOffer) => `${chatId}:${offer.id}`;

/** The offer's plan, kept across remounts while the window lives. */
export function planOf(chatId: string, offer: ImportOffer): ImportPlan {
  const key = planKey(chatId, offer);
  let plan = plans.get(key);
  if (!plan) {
    plan = { key, offer, picks: offeredPicks(offer) };
    plans.set(key, plan);
  }
  return plan;
}

export function usePlan(chatId: string, offer: ImportOffer) {
  const key = planKey(chatId, offer);
  return (
    useSyncExternalStore(subscribe, () => plans.get(key)) ??
    planOf(chatId, offer)
  );
}

export function setPicks(plan: ImportPlan, picks: ImportPicks) {
  plans.set(plan.key, { ...plan, picks });
  changed();
}

/** The plan whose list is on screen lends the sidebar its stand-ins; one at a time. */
export function showPlan(plan: ImportPlan | undefined, key?: string) {
  if (plan) shown = plan.key;
  else if (shown === key) shown = undefined;
  else return;
  changed();
}

/** The open thread's plan, while it waits to be imported. */
export function useShownPlan() {
  return useSyncExternalStore(subscribe, () =>
    shown ? plans.get(shown) : undefined,
  );
}

/** The new projects the plan brings in, as sidebar rows. */
function ghosts(plan: ImportPlan): Project[] {
  return plan.offer.projects
    .filter((p) => !p.projectId && plan.picks[p.key])
    .map((p) => ({
      id: ghostId(p.key),
      name: p.name,
      path: p.path,
      ...(p.group ? { folder: p.group } : {}),
      automaticName: null,
      repository: null,
      added: 0,
    }));
}

/** The sidebar's projects with the plan's new ones standing among them. */
export function plannedProjects(real: Project[], plan: ImportPlan): Project[] {
  const rows = ghosts(plan);
  if (plan.order) return withGhosts(real, rows, plan.order);
  let list = [...real];
  for (const g of rows)
    list = moveProjectInList([...list, g], g.id, g.folder ?? "", null);
  return list;
}

/** How many chats each project in the sidebar gains, stand-ins and projects already here alike. */
export function plannedChats(plan: ImportPlan) {
  return new Map(
    plan.offer.projects.flatMap((p) => {
      const n = plan.picks[p.key]?.length;
      return n === undefined ? [] : [[p.projectId ?? ghostId(p.key), n]];
    }),
  );
}

/** A drag in the sidebar: the plan remembers where everything stands now. */
export function movePlanned(
  plan: ImportPlan,
  listed: Project[],
  id: string,
  folder: string,
  before: string | null,
) {
  const order = moveProjectInList(
    listed.map((p) => ({
      id: p.id,
      ...(p.folder ? { folder: p.folder } : {}),
    })),
    id,
    folder,
    before,
  );
  const current = plans.get(plan.key) ?? plan;
  const groups = new Map(
    order.flatMap((p) =>
      ghostKey(p.id) ? [[ghostKey(p.id)!, p.folder ?? ""]] : [],
    ),
  );
  plans.set(plan.key, {
    ...current,
    order,
    // The list says where each new project goes, so it follows the drag.
    offer: {
      ...current.offer,
      projects: current.offer.projects.map((p) =>
        groups.has(p.key) ? { ...p, group: groups.get(p.key)! } : p,
      ),
    },
  });
  changed();
}

/** Group `from` became `to` (its parent when removed): the plan's new projects in it go along. */
export function regroupPlanned(plan: ImportPlan, from: string, to: string) {
  const current = plans.get(plan.key) ?? plan;
  const rebase = (folder = "") => (folder ? rebaseGroup(folder, from, to) : "");
  plans.set(plan.key, {
    ...current,
    ...(current.order && {
      order: current.order.map(({ id, folder }) =>
        rebase(folder) ? { id, folder: rebase(folder) } : { id },
      ),
    }),
    offer: {
      ...current.offer,
      projects: current.offer.projects.map((p) =>
        p.projectId ? p : { ...p, group: rebase(p.group) },
      ),
    },
  });
  changed();
}

/**
 * The real project a move should land above when the sidebar shows it above
 * a stand-in: the next real one in its group, or the end of the group.
 */
export function realBefore(
  listed: Project[],
  folder: string,
  before: string | null,
) {
  if (!before || !ghostKey(before)) return before;
  const at = listed.findIndex((p) => p.id === before);
  return (
    listed
      .slice(at + 1)
      .find((p) => !ghostKey(p.id) && (p.folder ?? "") === folder)?.id ?? null
  );
}

/** Every chat of the offer it could still bring in, by project. */
export const allPicks = (offer: ImportOffer): ImportPicks =>
  Object.fromEntries(
    offer.projects
      .filter((p) => !p.projectId || freshChats(p).length)
      .map((p) => [p.key, freshChats(p).map((c) => c.id)]),
  );
