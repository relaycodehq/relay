// How much of what a call wrote is kept: all files together fit in
// `writtenLimit`, the rest cut off. A file past the limit keeps its path, so
// the trace still names every file the call changed.
import type { WrittenCode } from "./projects";

/** Characters of written code a call keeps, all files together. */
export const writtenLimit = 16_000;

function writtenSize(file: WrittenCode) {
  switch (file.kind) {
    case "whole":
      return file.content.length;
    case "patch":
      return file.diff.length;
    case "swap":
      return file.edits.reduce((n, e) => n + e.old.length + e.new.length, 0);
  }
}

/** Fits what a call wrote into `writtenLimit`; a file that lost anything says `cut`. */
export function capWritten(files: WrittenCode[]): WrittenCode[] {
  let room = writtenLimit;
  const take = (text: string) => {
    const piece = text.slice(0, Math.max(0, room));
    room -= piece.length;
    return piece;
  };
  return files.map((file) => {
    const size = writtenSize(file);
    const kept = keptOf(file, take);
    return writtenSize(kept) < size ? { ...kept, cut: true } : kept;
  });
}

function keptOf(file: WrittenCode, take: (text: string) => string): WrittenCode {
  switch (file.kind) {
    case "whole":
      return { ...file, content: take(file.content) };
    case "patch":
      return { ...file, diff: take(file.diff) };
    case "swap": {
      // An edit the limit took all of is gone, not a blank passage.
      const edits = file.edits.map((e) => ({ old: take(e.old), new: take(e.new) }));
      return { ...file, edits: edits.filter((e) => e.old || e.new) };
    }
  }
}
