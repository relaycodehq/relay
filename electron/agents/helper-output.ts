import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A helper model's reply without the code fence some models wrap JSON in. */
export const unfence = (output: string) =>
  output.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

// Helper runs only read the prompt they're given, never the checkout, so they
// start in an empty directory. Starting in the checkout made Codex fail on its
// (denied) AGENTS.md.
let emptyDirectory: Promise<string> | undefined;
export function emptyCwd() {
  emptyDirectory ??= mkdtemp(join(tmpdir(), "relay-helper-")).catch((e) => {
    emptyDirectory = undefined;
    throw e;
  });
  return emptyDirectory;
}
