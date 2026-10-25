import { sliceWhole } from "../../shared/truncate";
import { toolText } from "../relay-mcp";

export const json = (value: unknown) =>
  toolText(JSON.stringify(value, null, 1));

/** The start of what the user is asked about. */
export const head = (text: string, limit = 600) =>
  text.length > limit ? `${sliceWhole(text, 0, limit)}…` : text;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The user's wall-clock time with its offset, like 2026-10-08T16:00:00+02:00.
 * Agents read a UTC `Z` stamp's hours out to the user as if they were local.
 */
export function localTime(at: number) {
  const d = new Date(at);
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
