/** A plain object from parsed JSON, not an array or null. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const asRecord = (value: unknown) => (isRecord(value) ? value : null);
