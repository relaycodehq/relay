import { git, gitBytes } from "./git";
import { digest } from "./hash";
import { imageSides } from "./image-pair";
import { NotText, decodeText } from "./working-files";
import { workingPathSchema } from "../shared/working-tree";
import type { FilePair } from "../shared/types";
import type {
  CommitDetail,
  CommitFileChange,
  CommitLog,
  CommitRef,
  CommitSummary,
  HistoryScope,
} from "../shared/history";

const FIELD = "\x1f";
const RECORD = "\x1e";
const summaryFormat = ["%H", "%P", "%an", "%at", "%D", "%s"].join("%x1f");

const refKinds = [
  ["refs/heads/", "branch"],
  ["refs/remotes/", "remote"],
  ["refs/tags/", "tag"],
] as const;
/** A `--decorate=full` decoration; the full name says what kind of ref it is. */
function parseRef(value: string): CommitRef | null {
  if (value === "HEAD") return { name: "HEAD", kind: "head" };
  const head = value.startsWith("HEAD -> ");
  const full = head ? value.slice(8) : value.replace(/^tag: /, "");
  const match = refKinds.find(([prefix]) => full.startsWith(prefix));
  if (!match || (match[1] === "remote" && full.endsWith("/HEAD"))) return null;
  return { name: full.slice(match[0].length), kind: head ? "head" : match[1] };
}
function parseSummary(fields: string[]): CommitSummary {
  const [sha, parents, author, time, refs, subject] = fields;
  return {
    sha,
    parents: parents ? parents.split(" ") : [],
    author,
    time: Number(time),
    refs: refs
      ? refs
          .split(", ")
          .map(parseRef)
          .filter((r): r is CommitRef => !!r)
      : [],
    subject,
  };
}

export async function commitLog(
  root: string,
  scope: HistoryScope,
  limit: number,
): Promise<CommitLog> {
  // A fresh repository has no HEAD to walk yet.
  if (
    scope === "head" &&
    !(await git(root, ["rev-parse", "--verify", "-q", "HEAD"]).catch(() => ""))
  )
    return { commits: [], more: false };
  const out = await git(root, [
    "log",
    "--decorate=full",
    "--topo-order",
    `--max-count=${limit + 1}`,
    `--format=${summaryFormat}%x1e`,
    ...(scope === "all" ? ["--branches", "--remotes", "--tags"] : ["HEAD"]),
    "--",
  ]);
  const commits = out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ""))
    .filter(Boolean)
    .map((r) => parseSummary(r.split(FIELD)));
  return { commits: commits.slice(0, limit), more: commits.length > limit };
}

async function commitFiles(
  root: string,
  sha: string,
  parent: string | undefined,
): Promise<CommitFileChange[]> {
  const range = parent ? [parent, sha] : ["--root", sha];
  const args = ["diff-tree", "-r", "-z", "-M", "--no-commit-id"];
  const [status, numstat] = await Promise.all([
    git(root, [...args, "--name-status", ...range]),
    git(root, [...args, "--numstat", ...range]),
  ]);
  const counts = new Map<string, [string, string]>();
  const stats = numstat.split("\0");
  for (let i = 0; i < stats.length - 1;) {
    const [additions, deletions, path] = stats[i].split("\t");
    // Renames leave the path empty and follow with the old and new names.
    if (path) i += 1;
    else i += 3;
    counts.set(path || stats[i - 1], [additions, deletions]);
  }
  const files: CommitFileChange[] = [];
  const names = status.split("\0");
  for (let i = 0; i < names.length - 1;) {
    const code = names[i][0] as CommitFileChange["status"];
    const moved = code === "R" || code === "C";
    const previousPath = moved ? names[i + 1] : undefined;
    const path = names[i + (moved ? 2 : 1)];
    i += moved ? 3 : 2;
    if (!workingPathSchema.safeParse(path).success) continue;
    const [additions, deletions] = counts.get(path) ?? ["0", "0"];
    files.push({
      path,
      ...(previousPath && { previousPath }),
      status: code,
      additions: Number(additions) || 0,
      deletions: Number(deletions) || 0,
      binary: additions === "-",
    });
  }
  return files;
}

async function resolveCommit(root: string, sha: string) {
  const [meta, body] = await Promise.all([
    git(root, [
      "show",
      "-s",
      "--decorate=full",
      `--format=${summaryFormat}%x1f%ae`,
      `${sha}^{commit}`,
      "--",
    ]),
    git(root, ["show", "-s", "--format=%b", `${sha}^{commit}`, "--"]),
  ]);
  const fields = meta.trimEnd().split(FIELD);
  return { ...parseSummary(fields), email: fields[6], body: body.trim() };
}

export async function commitDetail(
  root: string,
  sha: string,
): Promise<CommitDetail> {
  const commit = await resolveCommit(root, sha);
  return {
    ...commit,
    files: await commitFiles(root, commit.sha, commit.parents[0]),
  };
}

/** One file as the commit left it, against its first parent. */
export async function commitDiff(
  root: string,
  sha: string,
  path: string,
): Promise<FilePair> {
  const commit = await resolveCommit(root, sha);
  const parent = commit.parents[0];
  const change = (await commitFiles(root, commit.sha, parent)).find(
    (f) => f.path === path,
  );
  if (!change) throw new Error("This commit didn't change that file.");
  const read = async (spec: string, name: string) => ({
    name,
    contents: decodeText(await gitBytes(root, ["show", spec, "--"])),
    cacheKey: "",
  });
  const oldName = change.previousPath ?? path,
    oldSpec = !parent || change.status === "A" ? null : `${parent}:${oldName}`,
    nextSpec = change.status === "D" ? null : `${commit.sha}:${path}`;
  let old: FilePair["old"], next: FilePair["next"];
  try {
    old = oldSpec ? await read(oldSpec, oldName) : null;
    next = nextSpec ? await read(nextSpec, path) : null;
  } catch (e) {
    if (e instanceof NotText)
      return {
        old: null,
        next: null,
        binary: true,
        images: await imageSides(
          root,
          oldSpec ? { name: oldName, spec: oldSpec } : null,
          nextSpec ? { name: path, spec: nextSpec } : null,
        ),
      };
    throw e;
  }
  for (const f of [old, next]) if (f) f.cacheKey = digest(f.contents);
  return { old, next, binary: false };
}
