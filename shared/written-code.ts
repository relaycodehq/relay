// How much of what a call wrote is kept: all files together fit in
// `writtenLimit`, and all of an answer's calls in `answerWrittenLimit`, the
// rest cut off. A file past the limit keeps its path, so the trace still
// names every file the call changed; so does a file that may hold secrets.
import type { AgentActivity, AgentTrace, WrittenCode } from "./projects";

/** Characters of written code a call keeps, all files together. */
export const writtenLimit = 16_000;

/** Characters of written code an answer keeps, all its calls together. */
export const answerWrittenLimit = 200_000;

/** Files that usually hold keys or passwords; `.env.example` and the like don't. */
const secretFile =
  /(?:^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[\w.-]+)?|\.npmrc|\.netrc|\.pgpass|\.git-credentials|credentials(?:\.\w+)?|secrets?\.\w+|id_(?:rsa|dsa|ecdsa|ed25519))$|\.(?:pem|key|p12|pfx|jks|keystore)$/i;

export const mayHoldSecrets = (path: string) => secretFile.test(path);

export function writtenSize(file: WrittenCode) {
  switch (file.kind) {
    case "whole":
      return file.content.length;
    case "patch":
      return file.diff.length;
    case "swap":
      return file.edits.reduce((n, e) => n + e.old.length + e.new.length, 0);
  }
}

/** Fits what a call wrote into `room`; a file that lost anything says `cut`, one that may hold secrets keeps nothing. */
export function capWritten(files: WrittenCode[], room = writtenLimit): WrittenCode[] {
  let left = room;
  const take = (text: string) => {
    const piece = text.slice(0, Math.max(0, left));
    left -= piece.length;
    return piece;
  };
  return files.map((file) => {
    if (mayHoldSecrets(file.path)) return { ...keptOf(file, () => ""), cut: true, secret: true };
    const size = writtenSize(file);
    const kept = keptOf(file, take);
    return writtenSize(kept) < size ? { ...kept, cut: true } : kept;
  });
}

/**
 * A call's written code, fitted into what the calls `before` it in its
 * answer left of `answerWrittenLimit`. First come, first kept: a call that
 * finishes late doesn't lose its code to the ones that came after it.
 */
export function writtenInAnswer(activity: AgentActivity, before: AgentTrace[]): AgentActivity {
  if (!activity.written?.length) return activity;
  const used = before.reduce((n, entry) => {
    const earlier = entry.kind === "activity" ? entry.activity.written : undefined;
    return n + (earlier ?? []).reduce((sum, file) => sum + writtenSize(file), 0);
  }, 0);
  const room = Math.min(writtenLimit, answerWrittenLimit - used);
  return { ...activity, written: capWritten(activity.written, room) };
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
