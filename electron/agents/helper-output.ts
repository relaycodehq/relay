import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A helper model's reply without the code fence some models wrap JSON in. */
export const unfence = (output: string) =>
  output.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

const CUT = "\n[…]\n";

/** The start and the end of a long text: the ask, and its final constraints. */
export function excerpt(text: string, budget: number) {
  if (text.length <= budget) return text;
  const half = Math.floor((budget - CUT.length) / 2);
  return text.slice(0, half) + CUT + text.slice(-half);
}

// Helper runs only read the prompt they're given, never the checkout, so they
// start in an empty directory. Starting in the checkout made Codex fail on its
// (denied) AGENTS.md.
let emptyDirectory: Promise<string> | undefined;

export async function emptyCwd(): Promise<string> {
  const made = (emptyDirectory ??= mkdtemp(
    join(tmpdir(), "relay-helper-"),
  ).catch((e) => {
    emptyDirectory = undefined;
    throw e;
  }));
  const dir = await made;
  // The system's temp cleaner takes a folder left alone for days, and a run
  // started in a missing folder fails as if its CLI weren't installed.
  if (await isDirectory(dir)) return dir;
  // Whoever notices first makes the next one.
  if (emptyDirectory === made) emptyDirectory = undefined;
  return emptyCwd();
}

const isDirectory = (path: string) =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
