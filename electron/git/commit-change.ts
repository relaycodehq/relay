import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitBytes } from "./git";
import { decodeText } from "./working-files";
import { assertCommittable, serializeRepo, workingTree } from "./working-tree";
import type { CommitFileChange } from "../../shared/commit-split";
import type { WorkingTree } from "../../shared/working-tree";

const plainFileModes = new Set(["100644", "100755"]);
/** The largest staged version read to merge the commit into. */
const STAGED_LIMIT = 32 * 1024 * 1024;

/** The file as a commit has it. */
interface CommittedFile {
  /** Empty when the commit hasn't got the file. */
  text: string;
  /** Null when the commit hasn't got the file. */
  blob: string | null;
  mode: string | null;
}

/** The file as the user's index has it. */
interface StagedFile {
  blob: string;
  mode: string;
}

/**
 * Commits one change of one file, as the editor's change bar showed it:
 * HEAD with just this file replaced by `change.content`. The file on disk
 * keeps its other edits, and what the user had staged stays staged.
 */
export async function commitFileChange(
  root: string,
  change: CommitFileChange,
): Promise<WorkingTree> {
  const message = change.message.trim();
  if (!message) throw new Error("Write a commit message first.");
  return serializeRepo(root, async () => {
    assertCommittable(await workingTree(root));
    // Empty on a branch with no commits yet.
    const head = (await git(root, ["rev-parse", "--revs-only", "HEAD"])).trim();
    const before = await committedFile(root, head, change.path);
    if (before.mode && !plainFileModes.has(before.mode))
      throw new Error("Only a plain file's change can be committed here.");
    if (before.text !== change.committed)
      throw new Error(
        "This file's last commit changed since the change was shown. Look at it again.",
      );
    if (change.content === before.text)
      throw new Error("Nothing to commit in this change.");
    const staged = await stagedEntry(root, change.path);
    const dir = await mkdtemp(join(tmpdir(), "relay-change-"));
    try {
      const blob = await storeBlob(root, join(dir, "change"), change.content);
      // Checked before committing, so a staged edit the change touches is never lost to the merge afterwards.
      if (staged && stagedApart(staged, before, blob))
        await mergedBlob(root, dir, staged.blob, before.text, change.content);
      const mode = before.mode ?? (await newFileMode(root, change.path, staged));
      await commitOnHead(root, dir, head, `${mode},${blob},${change.path}`, message);
      // A commit hook may have reformatted the file, so the index takes what was committed.
      const after = await committedFile(root, "HEAD", change.path);
      await carryIntoIndex(root, dir, change.path, staged, before, after).catch((e) => {
        throw new Error(
          `Committed, but what you staged in this file couldn't be updated: ${e instanceof Error ? e.message : e}`,
        );
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return workingTree(root);
  });
}

async function committedFile(root: string, rev: string, path: string): Promise<CommittedFile> {
  const entry = rev ? await git(root, ["ls-tree", "-z", rev, "--", path]) : "";
  if (!entry) return { text: "", blob: null, mode: null };
  const [mode, type, blob] = entry.slice(0, entry.indexOf("\t")).split(" ");
  if (type !== "blob") throw new Error("Only a plain file's change can be committed here.");
  // Read as the editor reads the committed text it compares with.
  const text = decodeText(await gitBytes(root, ["show", `${rev}:./${path}`]));
  return { text, blob, mode };
}

/** Whether the index holds a version of the file that is neither HEAD's nor the change's own. */
const stagedApart = (staged: StagedFile, before: CommittedFile, change: string) =>
  staged.blob !== before.blob && staged.blob !== change;

/** A file new to Git keeps the mode it's staged with, or the executable bit it has on disk. */
async function newFileMode(root: string, path: string, staged: StagedFile | null) {
  if (staged && plainFileModes.has(staged.mode)) return staged.mode;
  const onDisk = await stat(join(root, path)).catch(() => null);
  return onDisk && onDisk.mode & 0o111 ? "100755" : "100644";
}

/** Stores `text` as a blob byte for byte: no line-ending or other filters. */
async function storeBlob(root: string, file: string, text: string) {
  await writeFile(file, text);
  const out = await git(root, ["hash-object", "-w", "--no-filters", file]);
  return out.trim();
}

/**
 * Commits `head`'s tree with `entry` in it, built in a scratch index so the
 * user's stays as it is. Git commits on whatever HEAD is by then, so a commit
 * made elsewhere since `head` was read is put back rather than undone by
 * this tree.
 */
async function commitOnHead(
  root: string,
  dir: string,
  head: string,
  entry: string,
  message: string,
) {
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  await git(root, head ? ["read-tree", head] : ["read-tree", "--empty"], { env });
  await git(root, ["update-index", "--add", "--cacheinfo", entry], { env });
  await git(root, ["commit", "-q", "-m", message], { env, timeout: 120000 });
  const parent = (await git(root, ["log", "-1", "--format=%P", "HEAD"])).trim();
  if (parent === head) return;
  const made = (await git(root, ["rev-parse", "HEAD"])).trim();
  await git(root, ["update-ref", "-m", "commit change: branch moved (Relay)", "HEAD", parent, made]);
  throw new Error("The branch got another commit meanwhile. Look at the change again.");
}

/**
 * Takes the commit into the user's index without unstaging anything. A file
 * with nothing staged now matches the new HEAD; one with other changes
 * staged keeps them, on top of the committed change. Merging rather than
 * applying the change as a patch keeps a staged change a line or two away,
 * which a patch's context lines wouldn't match.
 */
async function carryIntoIndex(
  root: string,
  dir: string,
  path: string,
  staged: StagedFile | null,
  before: CommittedFile,
  after: CommittedFile,
) {
  if (!after.blob || !after.mode) throw new Error("The commit hasn't got the file.");
  if (!staged) {
    // A file new to Git is tracked now; a staged deletion stays staged.
    if (!before.blob)
      await git(root, ["update-index", "--add", "--cacheinfo", `${after.mode},${after.blob},${path}`]);
    return;
  }
  if (staged.blob === after.blob) return; // the change was staged already
  const blob =
    staged.blob === before.blob
      ? after.blob
      : await mergedBlob(root, dir, staged.blob, before.text, after.text);
  await git(root, ["update-index", "--cacheinfo", `${staged.mode},${blob},${path}`]);
}

async function stagedEntry(root: string, path: string): Promise<StagedFile | null> {
  const out = await git(root, ["ls-files", "--stage", "-z", "--", path]);
  for (const line of out.split("\0")) {
    const tab = line.indexOf("\t");
    if (tab < 0 || line.slice(tab + 1) !== path) continue;
    const [mode, blob] = line.slice(0, tab).split(" ");
    return { mode, blob };
  }
  return null;
}

/** The staged version with the commit merged in; refused where the two change the same lines. */
async function mergedBlob(
  root: string,
  dir: string,
  staged: string,
  base: string,
  committed: string,
) {
  const [ours, old, theirs] = ["staged", "base", "committed"].map((name) =>
    join(dir, name),
  );
  const bytes = await gitBytes(
    root,
    ["cat-file", "blob", staged],
    STAGED_LIMIT,
  );
  await writeFile(ours, bytes);
  await writeFile(old, base);
  await writeFile(theirs, committed);
  // Exits non-zero for each conflict.
  await git(root, ["merge-file", "-q", ours, old, theirs]).catch(() => {
    throw new Error(
      "You've staged edits on lines next to this change. Commit or unstage them first.",
    );
  });
  const out = await git(root, ["hash-object", "-w", "--no-filters", ours]);
  return out.trim();
}
