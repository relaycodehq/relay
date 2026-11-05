/** `list` in runs of at most `size`, e.g. to keep a command line short. */
export function chunks<T>(list: readonly T[], size: number): T[][] {
  const runs: T[][] = [];
  for (let i = 0; i < list.length; i += size)
    runs.push(list.slice(i, i + size));
  return runs;
}

/**
 * `paths` in runs that fit one command line each: Windows caps a whole
 * command line at 32k characters, so the paths get 24k of it. A path longer
 * than that still gets a run of its own.
 */
export function commandLineRuns(paths: readonly string[]): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  let length = 0;
  for (const path of paths) {
    // Each path takes a space and, quoted, two more characters.
    const room = path.length + 3;
    if (run.length && length + room > 24_000) {
      runs.push(run);
      run = [];
      length = 0;
    }
    run.push(path);
    length += room;
  }
  if (run.length) runs.push(run);
  return runs;
}
