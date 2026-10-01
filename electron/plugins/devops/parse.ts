import type { WorkItem } from "../../../shared/devops";

/** What a work item card shows, asked of every batch. */
export const itemFields = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.AreaPath",
  "System.TeamProject",
  "System.Tags",
  "System.ChangedDate",
  "System.AssignedTo",
  "System.IterationId",
  "Microsoft.VSTS.Common.Priority",
  "System.Description",
  "Microsoft.VSTS.TCM.ReproSteps",
];

export function toWorkItem(
  base: string,
  id: number,
  f: Record<string, unknown>,
  sprints: Set<number>,
): WorkItem {
  const text = (k: string) =>
    typeof f[k] === "string" ? (f[k] as string) : "";
  const project = text("System.TeamProject");
  const assignee = f["System.AssignedTo"];
  return {
    id,
    title: text("System.Title"),
    type: text("System.WorkItemType"),
    state: text("System.State"),
    areaPath: text("System.AreaPath"),
    project,
    tags: text("System.Tags")
      .split(";")
      .map((t) => t.trim())
      .filter(Boolean),
    changed: text("System.ChangedDate"),
    priority:
      typeof f["Microsoft.VSTS.Common.Priority"] === "number"
        ? f["Microsoft.VSTS.Common.Priority"]
        : null,
    currentSprint: sprints.has(f["System.IterationId"] as number),
    assignedTo:
      typeof assignee === "string" ? assignee : (identityName(assignee) ?? ""),
    description: plainText(
      text("System.Description") || text("Microsoft.VSTS.TCM.ReproSteps"),
    ).slice(0, 2000),
    url: `${base}/${encodeURIComponent(project)}/_workitems/edit/${id}`,
  };
}

export const identityName = (value: unknown) =>
  value && typeof value === "object" && "displayName" in value
    ? String(value.displayName)
    : undefined;

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
export function plainText(html: string) {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] !== "#") return entities[e.toLowerCase()] ?? m;
      const code =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      // fromCodePoint throws on values past U+10FFFF.
      return code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}
