import { NotText, decodeText, textLimit } from "./working-files";
import { run } from "./turn-snapshots";
import { digest } from "../util/hash";
import { imageSides, type FileSource } from "./image-pair";
import { videoSides } from "./video-pair";
import { gitBytes } from "./git";
import type { FilePair } from "../../shared/types";

/** One file between two commits or trees, as text unless it's binary or too big. */
export async function revisionDiff(
  root: string,
  from: string,
  to: string,
  path: string,
): Promise<FilePair> {
  let binary = false;
  const read = async (rev: string) => {
    const spec = `${rev}:${path}`;
    const size = await run(root, ["cat-file", "-s", spec]).then(
      (s) => Number(s.trim()),
      () => null,
    );
    if (size === null) return submoduleSide(root, rev, path);
    if (size > textLimit) {
      binary = true;
      return null;
    }
    let contents: string;
    try {
      contents = decodeText(await gitBytes(root, ["cat-file", "blob", spec]));
    } catch (e) {
      if (!(e instanceof NotText)) throw e;
      binary = true;
      return null;
    }
    return { name: path, contents, cacheKey: digest(contents) };
  };
  const [old, next] = await Promise.all([read(from), read(to)]);
  if (!binary) return { old, next, binary: false };
  const sides: [FileSource, FileSource] = [
    { name: path, spec: `${from}:${path}` },
    { name: path, spec: `${to}:${path}` },
  ];
  const [images, videos] = await Promise.all([
    imageSides(root, ...sides),
    videoSides(root, ...sides),
  ]);
  return { old: null, next: null, binary: true, images, videos };
}

/**
 * A submodule or nested repository as `git diff` writes it: the commit it
 * points at, whose contents aren't in this repository. Null when `rev` has
 * no such entry at `path`.
 */
async function submoduleSide(root: string, rev: string, path: string) {
  const entry = await run(root, ["ls-tree", "-z", rev, "--", path], {
    GIT_LITERAL_PATHSPECS: "1",
  }).catch(() => "");
  const [mode, , commit] = entry.slice(0, entry.indexOf("\t")).split(" ");
  if (mode !== "160000") return null;
  const contents = `Subproject commit ${commit}\n`;
  return { name: path, contents, cacheKey: digest(contents) };
}
