import type { LocalFile, PullRef } from "../shared/types";
import { shaSchema } from "../shared/validation";
import { inspectFolder } from "./repository";
import {
  decodeText,
  safeWorkingPath,
  readWorkingFile,
  writeWorkingFile,
} from "./working-files";
import { digest } from "./hash";
import { gitBytes } from "./git";
async function validate(
  root: string,
  server: string,
  ref: PullRef,
  head: string,
  path: string,
) {
  shaSchema.parse(head);
  const local = await inspectFolder(root, server, ref);
  if (!local.remoteMatches)
    throw new Error(
      "The linked folder’s remote no longer matches this repository. Relink the correct folder.",
    );
  if (local.head !== head)
    throw new Error(
      "Your checkout is on a different commit. Check out this PR’s head before editing. Your local files have not been changed.",
    );
  const full = await safeWorkingPath(local.path, path);
  const tree = (
    await gitBytes(local.path, ["ls-tree", "-z", head, "--", path])
  ).toString("utf8");
  if (
    !/^100(644|755) blob [a-f0-9]+\t/.test(tree) ||
    tree.slice(tree.indexOf("\t") + 1) !== `${path}\0`
  )
    throw new Error(
      "This file is not a regular file in the PR head. Deleted files and submodules cannot be edited here.",
    );
  return { full, local };
}
export async function readLocalFile(
  root: string,
  server: string,
  ref: PullRef,
  head: string,
  path: string,
): Promise<LocalFile> {
  const { full, local } = await validate(root, server, ref, head, path);
  const [disk, original] = await Promise.all([
    readWorkingFile(local.path, path),
    gitBytes(local.path, ["show", `${head}:${path}`]),
  ]);
  if (!disk) throw new Error("This file was deleted locally.");
  return {
    path: full,
    branch: local.branch,
    head,
    contents: disk.contents,
    original: decodeText(original),
    version: disk.hash,
  };
}
export async function saveLocalFile(
  root: string,
  server: string,
  ref: PullRef,
  head: string,
  path: string,
  version: string,
  contents: string,
) {
  await writeWorkingFile(root, path, version, { contents }, async () => {
    const { local } = await validate(root, server, ref, head, path);
    if (!(await readWorkingFile(local.path, path)))
      throw new Error("This file was deleted locally.");
  });
  return { version: digest(contents) };
}
