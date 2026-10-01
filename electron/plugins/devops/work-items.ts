import {
  currentSprintField,
  type DevOpsSettings,
  type SortKey,
  type WorkItem,
  type WorkItemField,
  type WorkItemScope,
} from "../../../shared/devops";
import type { DevOpsClient } from "./client";
import { sortItems } from "./order";
import { itemFields, toWorkItem } from "./parse";
import { currentSprints } from "./sprints";
import { workItemsQuery } from "./wiql";

/**
 * Your items or the team's: assigned to you or to its members, each through
 * its own filters, in the order Settings gives. `known` lists the
 * organization's fields, asked only when a display name needs looking up.
 */
export async function loadWorkItems(
  client: DevOpsClient,
  settings: DevOpsSettings,
  scope: WorkItemScope,
  known: () => Promise<WorkItemField[]>,
): Promise<WorkItem[]> {
  const reference = async (name: string) => {
    if (name.includes(".")) return name;
    const lower = name.toLowerCase();
    const found = (await known()).find(
      (f) =>
        f.name.toLowerCase() === lower ||
        f.referenceName.toLowerCase() === lower,
    );
    if (!found)
      throw new Error(`Azure DevOps has no work item field called “${name}”.`);
    return found.referenceName;
  };
  const sortKeys: SortKey[] = [];
  for (const k of settings.sort.fields)
    sortKeys.push(
      k.field === currentSprintField
        ? k
        : { ...k, field: await reference(k.field) },
    );
  const filters = [];
  for (const f of scope === "team"
    ? settings.team.filters
    : settings.mine.filters)
    filters.push({ ...f, field: await reference(f.field) });
  const ids = await client.wiql(
    settings.project,
    workItemsQuery(
      scope === "mine" ? null : settings.team.members,
      filters,
      !!settings.project,
    ),
  );
  if (!ids.length) return [];
  const found = await client.workItems(ids, [
    ...new Set([
      ...itemFields,
      ...sortKeys.map((k) => k.field).filter((f) => f !== currentSprintField),
    ]),
  ]);
  const sprints = sortKeys.some((k) => k.field === currentSprintField)
    ? await currentSprints(client, [
        ...new Set(found.map((w) => String(w.fields["System.TeamProject"]))),
      ])
    : new Set<number>();
  return sortItems(found, sortKeys, ids, sprints).map((w) =>
    toWorkItem(client.base, w.id, w.fields, sprints),
  );
}
