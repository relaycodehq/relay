import { currentSprintField, type SortKey } from "../../../shared/devops";
import type { FoundItem } from "./client";
import { identityName } from "./parse";

/**
 * Sorts by each key in turn. Ties keep `ids`' order, the WIQL's most
 * recently changed first.
 */
export function sortItems(
  found: FoundItem[],
  keys: SortKey[],
  ids: number[],
  sprints: Set<number>,
) {
  const order = new Map(ids.map((id, i) => [id, i]));
  const value = (w: FoundItem, field: string) =>
    field === currentSprintField
      ? Number(sprints.has(w.fields["System.IterationId"] as number))
      : fieldValue(w.fields, field);
  return found.sort(
    (a, b) =>
      keys.reduce(
        (by, k) =>
          by || compareField(value(a, k.field), value(b, k.field), k.direction),
        0,
      ) || order.get(a.id)! - order.get(b.id)!,
  );
}

/** A field from a batch answer; a hand-typed reference name may differ in case. */
export function fieldValue(fields: Record<string, unknown>, reference: string) {
  if (reference in fields) return fields[reference];
  const lower = reference.toLowerCase();
  return Object.entries(fields).find(([k]) => k.toLowerCase() === lower)?.[1];
}

/** One sort key's verdict; an item without the field sorts last either way. */
export function compareField(
  a: unknown,
  b: unknown,
  direction: SortKey["direction"],
) {
  const value = (v: unknown) =>
    typeof v === "number"
      ? v
      : typeof v === "boolean"
        ? Number(v)
        : typeof v === "string"
          ? v || undefined
          : identityName(v);
  const x = value(a),
    y = value(b);
  if (x === undefined || y === undefined)
    return x === y ? 0 : x === undefined ? 1 : -1;
  const by =
    typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y), undefined, { numeric: true });
  return direction === "asc" ? by : -by;
}
