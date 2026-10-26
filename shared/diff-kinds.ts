// What kind of file a changed path is, so a change's lines can be told apart:
// a lockfile bump shouldn't make a 100-line fix read as 5,000 lines.

export type DiffKind = "code" | "tests" | "fixtures" | "docs" | "generated";

interface Stat {
  additions: number;
  deletions: number;
}

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "Podfile.lock",
  "Package.resolved",
  "go.sum",
  "gradle.lockfile",
  "flake.lock",
  "mix.lock",
  "pubspec.lock",
]);

const GENERATED = /(^|\/)__generated__\/|\.min\.(js|css)$|\.pb\.go$|_pb2\.py$/;
// Data tests read rather than tests themselves; snapshots are rewritten whole.
// Swift packages keep theirs in `Fixtures/`, JVM projects in test resources.
const FIXTURES =
  /(^|\/)(__mocks__|__fixtures__|__snapshots__|mocks?|fixtures?|testdata)\/|(^|\/)src\/(test|androidTest)\/resources\/|\.snap$/i;
const TEST_DIR =
  /(^|\/)(tests?|Tests|__tests__|spec|e2e|androidTest|testFixtures|\w+Tests)\//;
const TEST_FILE =
  /\.(test|spec)\.[^/]+$|_test\.(go|py|rb|exs?)$|(^|\/)test_[^/]+\.py$|_spec\.rb$|Tests?\.(kt|java|swift|cs)$/;
const DOCS = /\.(md|mdx|markdown|rst|adoc)$/i;

export function diffKind(path: string): DiffKind {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (LOCKFILES.has(name) || GENERATED.test(path)) return "generated";
  if (FIXTURES.test(path)) return "fixtures";
  if (TEST_DIR.test(path) || TEST_FILE.test(path)) return "tests";
  if (DOCS.test(path)) return "docs";
  return "code";
}

export function statsByKind(files: readonly (Stat & { path: string })[]) {
  const by: Record<DiffKind, Stat> = {
    code: { additions: 0, deletions: 0 },
    tests: { additions: 0, deletions: 0 },
    fixtures: { additions: 0, deletions: 0 },
    docs: { additions: 0, deletions: 0 },
    generated: { additions: 0, deletions: 0 },
  };
  for (const f of files) {
    const s = by[diffKind(f.path)];
    s.additions += f.additions;
    s.deletions += f.deletions;
  }
  return by;
}

/**
 * The lines a change is said to have: generated files left out, unless
 * nothing else changed, when they are all there is to show.
 */
export function headlineStat(by: Record<DiffKind, Stat>): Stat {
  const written = (["code", "tests", "fixtures", "docs"] as const).reduce(
    (t, k) => ({
      additions: t.additions + by[k].additions,
      deletions: t.deletions + by[k].deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  return written.additions || written.deletions ? written : by.generated;
}
