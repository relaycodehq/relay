// Variables a test run can inherit from the shell that starts it, none of
// which a test wants. A Relay thread exports RELAY_DEV_*, so every launched app
// would load the user's live dev renderer instead of the build under test.
// `git bisect run`, `rebase --exec` and git hooks export GIT_*, so a spec's
// `git init <tmp>` would re-init Relay's own repo (as bare) instead.
const leaking =
  /^(RELAY_DEV_\w+|GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|PREFIX))$/;

/** Runs in the runner's config, before any worker or launched app copies the env. */
export function dropInheritedEnv(env: NodeJS.ProcessEnv = process.env) {
  for (const key of Object.keys(env)) if (leaking.test(key)) delete env[key];
}
