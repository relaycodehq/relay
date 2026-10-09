/**
 * How the user left each started-threads family in Activity, by its lead's id:
 * true open, false folded. A family nobody toggled opens or folds by itself.
 */
export type FamilyFolds = Readonly<Record<string, boolean>>;

/** The most recently toggled kept, so leads long gone don't pile up. */
const keep = 200;

export function parseFamilyFolds(saved: unknown): FamilyFolds {
  if (!saved || typeof saved !== "object") return {};
  return Object.fromEntries(
    Object.entries(saved).filter(([, open]) => typeof open === "boolean"),
  );
}

/** `folds` with `lead` set, moved to the newest end and the oldest past `keep` dropped. */
export function withFamilyFold(folds: FamilyFolds, lead: string, open: boolean): FamilyFolds {
  const entries = Object.entries(folds).filter(([id]) => id !== lead);
  entries.push([lead, open]);
  return Object.fromEntries(entries.slice(-keep));
}
