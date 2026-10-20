/** What `listRows` needs of a SearchSelect option. */
interface Row {
  value: string;
  group?: string;
  folded?: boolean;
}

/**
 * The rows on screen, by group, and how many the limit left out. The fold
 * has a limit of its own, so opening it shows its rows however long the
 * list above it is; the picked one always shows.
 */
export function listRows<O extends Row>(
  matches: readonly O[],
  {
    foldOpen,
    limit,
    value,
  }: { foldOpen: boolean; limit?: number; value?: string },
) {
  const groups = new Map<string | undefined, O[]>();
  let listed = 0;
  let over = 0;
  const shown = { open: 0, folded: 0 };
  for (const o of matches) {
    if (!foldOpen && o.folded) continue;
    const part = o.folded ? "folded" : "open";
    if (limit !== undefined && shown[part] >= limit && o.value !== value) {
      over++;
      continue;
    }
    shown[part]++;
    listed++;
    const group = groups.get(o.group);
    if (group) group.push(o);
    else groups.set(o.group, [o]);
  }
  return { groups, listed, over };
}
