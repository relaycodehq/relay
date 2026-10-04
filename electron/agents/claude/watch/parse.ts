/** What the watcher found, before Relay gives it an id and a source. */
export type ParsedNote = {
  tag: "Heads up" | "You should know";
  line: string;
  title: string;
  points: string[];
  diff?: { file: string; lines: string[] };
  steer?: string;
};

const limits = { line: 300, title: 80, point: 400, points: 5, diffLines: 6 };

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** Labels a model might bold, quote or space differently. */
const label = (line: string) =>
  /^[\s>*_`"]*([a-z]+)[\s*_`"]*:[\s*_]*(.*)$/i.exec(line);

const isNone = (text: string) => /^none\b|^$/i.test(text.trim());

/**
 * Reads the watcher's answer. Anything that isn't a clear note, including
 * `learn: none` and replies that drifted from the shape, is null.
 */
export function parseNote(reply: string): ParsedNote | null {
  const lines = reply.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => label(l)?.[1].toLowerCase() === "learn");
  if (start === -1) return null;
  const learn = label(lines[start])![2].trim();
  if (isNone(learn)) return null;

  let tag: ParsedNote["tag"] = "You should know";
  let title = "";
  let steer: string | undefined;
  let file: string | undefined;
  const points: string[] = [];
  const diff: string[] = [];
  let fenced = false;
  for (const raw of lines.slice(start + 1)) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      if (file && diff.length < limits.diffLines) diff.push(raw.trimEnd());
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw);
    if (bullet) {
      if (points.length < limits.points)
        points.push(clip(bullet[1].trim(), limits.point));
      continue;
    }
    const field = label(raw);
    if (!field) continue;
    const value = field[2].trim();
    switch (field[1].toLowerCase()) {
      case "tag":
        tag = /heads/i.test(value) ? "Heads up" : "You should know";
        break;
      case "title":
        title = clip(value.replace(/^\*\*|\*\*$/g, ""), limits.title);
        break;
      case "diff":
        file = isNone(value) ? undefined : value.replace(/^`|`$/g, "");
        break;
      case "ask":
        steer = isNone(value) ? undefined : value;
        break;
    }
  }
  return {
    tag,
    line: clip(learn, limits.line),
    title: title || clip(learn, limits.title),
    points,
    ...(file && diff.length ? { diff: { file, lines: diff } } : {}),
    ...(steer ? { steer } : {}),
  };
}

/** Two notes about the same thing, worded nearly alike. */
export const sameNote = (a: string, b: string) => {
  const key = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return key(a) === key(b);
};
