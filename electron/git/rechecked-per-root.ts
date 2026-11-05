/** How long an answer about a repository's config stands before it's asked again. */
const RECHECK_MS = 60_000;

/** What's known about one root: the last answer, if any, and the asking under way. */
export type RootCheck<T> = {
  at: number;
  value: T | undefined;
  done: Promise<T>;
};

/**
 * `ask` for each root, the answer standing for a minute. While a root is
 * asked again, its last answer stays known, so a read needn't wait on it.
 */
export function recheckedPerRoot<T>(
  ask: (file: string, root: string, env: NodeJS.ProcessEnv) => Promise<T>,
) {
  const checks = new Map<string, RootCheck<T>>();
  return (file: string, root: string, env: NodeJS.ProcessEnv) => {
    const last = checks.get(root);
    if (last && Date.now() - last.at < RECHECK_MS) return last;
    const done = ask(file, root, env);
    const check: RootCheck<T> = { at: Date.now(), value: last?.value, done };
    checks.set(root, check);
    void done.then(
      (value) => (check.value = value),
      () => {},
    );
    return check;
  };
}
