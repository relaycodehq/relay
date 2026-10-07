import { hostname } from "node:os";

let chosen: string | undefined;

/** What phones and other computers call this one: the name it was given, else its host name. */
export const computerName = () =>
  chosen || hostname().replace(/\.local$/, "") || "Relay";

/** A headless Relay's `--name`; the desktop keeps the host name. */
export function setComputerName(name: string | undefined) {
  chosen = name?.trim().slice(0, 80) || undefined;
}
