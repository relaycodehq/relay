import {
  currentSprintField,
  defaultDevOpsSettings,
  devopsSettingsSchema,
  type DevOpsSettings,
  type SortKey,
} from "../../../shared/devops";

/** The saved settings over the defaults, older saves brought up to date. */
export function readSettings(saved: DevOpsSettings | undefined) {
  return devopsSettingsSchema.parse(
    saved
      ? {
          ...defaultDevOpsSettings,
          ...saved,
          filter: { ...defaultDevOpsSettings.filter, ...saved.filter },
          sort: savedSort(saved.sort),
          mine: { ...defaultDevOpsSettings.mine, ...saved.mine },
          team: { ...defaultDevOpsSettings.team, ...saved.team },
        }
      : defaultDevOpsSettings,
  );
}

/**
 * The saved order. Before the current sprint was a sort key of its own, a
 * switch put it ahead of the fields.
 */
function savedSort(sort: unknown): DevOpsSettings["sort"] {
  const saved = (sort ?? {}) as {
    currentSprint?: boolean;
    fields?: SortKey[];
  };
  const fields = saved.fields ?? defaultDevOpsSettings.sort.fields;
  return {
    fields: saved.currentSprint
      ? [
          { field: currentSprintField, direction: "desc" as const },
          ...fields,
        ].slice(0, 3)
      : fields,
  };
}
