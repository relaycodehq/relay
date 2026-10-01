import type { DevOpsClient, IterationNode } from "./client";

const day = 24 * 60 * 60_000;

/**
 * The iterations running today in these projects, whichever team plans
 * them. Projects whose iterations can't be read add none.
 */
export async function currentSprints(client: DevOpsClient, projects: string[]) {
  const now = Date.now(),
    current = new Set<number>();
  await Promise.all(
    projects.map(async (project) => {
      try {
        runningSprints(await client.iterations(project), now, current);
      } catch {
        // Without sprint dates the items still sort by priority.
      }
    }),
  );
  return current;
}

/** Adds the ids under `node` whose dates hold `now` to `into`. */
export function runningSprints(
  node: IterationNode,
  now: number,
  into = new Set<number>(),
) {
  const start = Date.parse(node.attributes?.startDate ?? ""),
    finish = Date.parse(node.attributes?.finishDate ?? "");
  // The finish date is the sprint's last day, so it runs through it.
  if (start <= now && now < finish + day) into.add(node.id);
  node.children?.forEach((child) => runningSprints(child, now, into));
  return into;
}
