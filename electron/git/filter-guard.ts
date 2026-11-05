import {
  filtersEmptied,
  foreignFilterKeys,
} from "../git-config/repository-filters";
import { refreshesIndex } from "./fsmonitor-guard";
import { recheckedPerRoot } from "./rechecked-per-root";

const checkFilters = recheckedPerRoot(foreignFilterKeys);

/**
 * The `-c` settings that keep a polled read from running the clean, smudge
 * or process filters the repository's own config names. Known once a root
 * has been checked, so Git starts before `git()` returns; the first read
 * of a root waits for the answer. Commands the person asked for (commit,
 * checkout) keep the repository's filters, unless Relay runs one as a
 * `polled` look of its own.
 */
export function filterOverride(
  file: string,
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  polled = false,
): string[] | Promise<string[]> {
  if (!polled && !refreshesIndex(args)) return [];
  const check = checkFilters(file, root, env);
  return check.value
    ? filtersEmptied(check.value)
    : check.done.then(filtersEmptied);
}
