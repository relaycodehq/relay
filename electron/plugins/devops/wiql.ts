import type { FieldFilter } from "../../../shared/devops";

const closedStates = ["Closed", "Done", "Removed", "Resolved", "Completed"];

const wiqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The ids of your items, or with `members` the team's, through `filters` on
 * reference names, most recently changed first. A filter on the state picks
 * the states; otherwise closed items stay out.
 */
export function workItemsQuery(
  members: string[] | null,
  filters: FieldFilter[],
  inProject: boolean,
) {
  const byState = filters.some((f) => f.field.toLowerCase() === "system.state");
  return [
    "SELECT [System.Id] FROM WorkItems",
    members
      ? `WHERE [System.AssignedTo] IN (${members.map(wiqlString).join(", ")})`
      : "WHERE [System.AssignedTo] = @Me",
    byState
      ? ""
      : `AND [System.State] NOT IN (${closedStates.map(wiqlString).join(", ")})`,
    ...filters.map(
      (f) => `AND [${f.field}] IN (${f.values.map(wiqlString).join(", ")})`,
    ),
    inProject ? "AND [System.TeamProject] = @project" : "",
    "ORDER BY [System.ChangedDate] DESC",
  ]
    .filter(Boolean)
    .join(" ");
}
