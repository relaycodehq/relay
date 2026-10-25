import type {
  ProjectReplaceResult,
  ProjectSearchQuery,
  ReplaceFile,
} from "../../shared/project-search";
import { errorMessage } from "../../shared/error-message";
import { readWorkingFile, writeWorkingFile } from "../git/working-files";
import { digest } from "../util/hash";
import { replaceInText, searchRegExp } from "./matcher";

const writers = 4;

type Outcome =
  | { path: string; count: number; version: string }
  | { path: string; reason: string };

/** Rewrites one file, or says why it was left alone. */
async function replaceInFile(
  root: string,
  file: ReplaceFile,
  re: RegExp,
  replacement: string,
  regex: boolean,
): Promise<Outcome> {
  const { path, version } = file;
  try {
    const current = await readWorkingFile(root, path);
    if (!current) return { path, reason: "This file is gone." };
    if (current.hash !== version)
      return {
        path,
        reason: "Changed on disk since the search. Search again.",
      };
    const done = replaceInText(re, current.contents, replacement, regex);
    if (!done.count) return { path, reason: "Nothing left to replace here." };
    await writeWorkingFile(root, path, current.hash, { contents: done.text });
    return { path, count: done.count, version: digest(done.text) };
  } catch (e) {
    return { path, reason: errorMessage(e) };
  }
}

/**
 * Replaces the query's matches in each file, line by line as the search read
 * them. A file whose bytes are not the ones the search saw (`version`) is
 * left alone, so a replacement never lands on text that moved. One file
 * failing does not stop the others.
 */
export async function replaceProjectText(
  root: string,
  query: ProjectSearchQuery,
  replacement: string,
  files: ReplaceFile[],
): Promise<ProjectReplaceResult> {
  const re = searchRegExp(query);
  const outcomes = new Array<Outcome>(files.length);
  let nextFile = 0;
  async function worker() {
    while (nextFile < files.length) {
      const i = nextFile++;
      outcomes[i] = await replaceInFile(
        root,
        files[i],
        re,
        replacement,
        query.regex,
      );
    }
  }
  await Promise.all(Array.from({ length: writers }, worker));
  const result: ProjectReplaceResult = { replaced: [], skipped: [] };
  for (const outcome of outcomes)
    if ("reason" in outcome) result.skipped.push(outcome);
    else result.replaced.push(outcome);
  return result;
}
