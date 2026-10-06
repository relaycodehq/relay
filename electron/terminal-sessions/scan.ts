import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline";

/** Enough of a session file to find the line that says where it ran. */
export const HEAD_BYTES = 64 * 1024;

/** The first `max` bytes of a file, and whether that was all of it. */
export async function head(path: string, max = HEAD_BYTES) {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(max);
    const { bytesRead } = await file.read(buffer, 0, max, 0);
    return {
      text: buffer.toString("utf8", 0, bytesRead),
      whole: bytesRead < max,
    };
  } finally {
    await file.close();
  }
}

/** The whole lines in the first `max` bytes of a file. */
export async function headLines(path: string, max = HEAD_BYTES) {
  const { text, whole } = await head(path, max);
  const lines = text.split("\n");
  if (!whole) lines.pop();
  return lines.filter((line) => line.trim());
}

/**
 * Calls `each` with every line of a file that contains one of `marks`, so
 * the many lines that can't matter are never parsed.
 */
export async function eachLine(
  path: string,
  marks: string[],
  each: (line: string) => void,
) {
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines)
    if (marks.some((mark) => line.includes(mark))) each(line);
}

export function parsed(line: string): Record<string, any> | undefined {
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** What was read from a file, kept until the file changes; reads at once share one. */
export class FileCache<T> {
  private entries = new Map<
    string,
    { mtime: number; size: number; value: Promise<T> }
  >();
  async get(
    path: string,
    read: (path: string) => Promise<T>,
    known?: { mtime: number; size: number },
  ): Promise<T> {
    let mtime: number, size: number;
    if (known) ({ mtime, size } = known);
    else {
      const s = await stat(path);
      mtime = s.mtimeMs;
      size = s.size;
    }
    const kept = this.entries.get(path);
    if (kept && kept.mtime === mtime && kept.size === size) return kept.value;
    const value = read(path);
    this.entries.set(path, { mtime, size, value });
    // A failed read is tried again next time.
    value.catch(() => {
      if (this.entries.get(path)?.value === value) this.entries.delete(path);
    });
    return value;
  }
}
