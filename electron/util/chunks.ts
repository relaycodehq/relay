/** `list` in runs of at most `size`, e.g. to keep a command line short. */
export function chunks<T>(list: readonly T[], size: number): T[][] {
  const runs: T[][] = [];
  for (let i = 0; i < list.length; i += size)
    runs.push(list.slice(i, i + size));
  return runs;
}
