// CI status in place of the folder icon in the thread header. Hover peeks,
// click opens the run that decides the colour. Three looks, each borrowed
// from something Relay already has. Sample data, the app's own styles.
// Open http://127.0.0.1:5177/previews/ci-status.html
import "./desktop-stub";
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PreviewCard } from "@base-ui/react/preview-card";
import {
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  FolderGit2,
  GitCommitHorizontal,
  GitPullRequest,
  UserRound,
} from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/sidebar.css";
import "../src/components/relay-mark.css";
import "../src/components/composer-model-picker.css";
import "./ci-status.css";
import { initAppearance, setMode, useAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import { RelayMark } from "../src/components/RelayMark";

initAppearance();
initWindowFocus();

type Variant = "pick" | "ring" | "card" | "dot";
type Source = "github" | "gitea";
type RunState = "success" | "failure" | "running";
type ScenarioKey = "passing" | "failing" | "building" | "unpushed" | "none";

interface Run {
  workflow: string;
  state: RunState;
  event: string;
  /** Minutes since it finished, or since it started while running. */
  minutes: number;
  duration: string;
  jobs: { done: number; total: number };
  failedJob?: string;
  id: number;
}
interface Scenario {
  label: string;
  branch: string;
  sha: string;
  message: string;
  author: string;
  pushed: number;
  runs: Run[];
  /** Local commits CI hasn't seen. */
  ahead?: number;
}

const checks = (state: RunState, minutes: number, id: number): Run => ({
  workflow: "Checks",
  state,
  event: "push",
  minutes,
  duration: state === "running" ? "1m 12s" : "3m 41s",
  jobs: state === "running" ? { done: 3, total: 5 } : { done: 5, total: 5 },
  failedJob: state === "failure" ? "typecheck" : undefined,
  id,
});
const release = (state: RunState, minutes: number, id: number): Run => ({
  workflow: "Release",
  state,
  event: "push",
  minutes,
  duration: state === "running" ? "48s" : "6m 02s",
  jobs: state === "running" ? { done: 1, total: 3 } : { done: 3, total: 3 },
  failedJob: state === "failure" ? "publish-mac" : undefined,
  id,
});

const scenarios: Record<ScenarioKey, Scenario> = {
  passing: {
    label: "Passing",
    branch: "main",
    sha: "31b7249",
    message: "Put two doc comments back on the functions they describe",
    author: "lubomirmolin",
    pushed: 14,
    runs: [checks("success", 9, 1101), release("success", 6, 1102)],
  },
  failing: {
    label: "Failing",
    branch: "main",
    sha: "f08ade0",
    message: "Let a thread work in its own git worktree",
    author: "lubomirmolin",
    pushed: 8,
    // Release finished last and green; the failed Checks run still wins.
    runs: [checks("failure", 4, 1201), release("success", 1, 1202)],
  },
  building: {
    label: "Building",
    branch: "main",
    sha: "bc093f3",
    message: "Credit files another thread changed during a turn to that thread",
    author: "lubomirmolin",
    pushed: 2,
    runs: [checks("running", 2, 1301), release("running", 2, 1302)],
  },
  unpushed: {
    label: "Unpushed commits",
    branch: "main",
    sha: "bb952a9",
    message: "Show how many tokens each reviewer processed",
    author: "lubomirmolin",
    pushed: 42,
    ahead: 2,
    runs: [checks("success", 38, 1401), release("success", 35, 1402)],
  },
  none: {
    label: "No CI",
    branch: "main",
    sha: "5b62990",
    message: "Write out code-review findings Claude answers with as JSON",
    author: "lubomirmolin",
    pushed: 20,
    runs: [],
  },
};

const RANK: Record<RunState, number> = { success: 0, running: 1, failure: 2 };

/** The worst state, and the run a click opens: failed, else running, else newest. */
function summary(runs: Run[]) {
  if (!runs.length) return null;
  const worst = runs.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));
  const target =
    worst.state === "success"
      ? runs.reduce((a, b) => (b.minutes < a.minutes ? b : a))
      : worst;
  return { state: worst.state, target };
}

function runUrl(source: Source, run: Run) {
  return source === "github"
    ? `https://github.com/lubomirmolin/relay/actions/runs/${run.id}`
    : `https://git.example.com/team/relay/actions/runs/${run.id}`;
}

const ago = (minutes: number) =>
  minutes < 1
    ? "just now"
    : minutes < 60
      ? `${minutes}m ago`
      : `${Math.round(minutes / 60)}h ago`;

const verb = (run: Run) =>
  run.state === "success"
    ? `Passed ${ago(run.minutes)}`
    : run.state === "failure"
      ? `Failed ${ago(run.minutes)}`
      : `Running · started ${ago(run.minutes)}`;

const STATE_WORD: Record<RunState, string> = {
  success: "Passing",
  failure: "Failing",
  running: "Building",
};

function StateIcon({ state, size = 14 }: { state: RunState; size?: number }) {
  const Icon =
    state === "success"
      ? CircleCheck
      : state === "failure"
        ? CircleX
        : CircleDashed;
  return (
    <Icon size={size} className="ci-glyph" data-state={state} aria-hidden />
  );
}

/** A context-meter-sized ring: filled by finished jobs, marked by the verdict. */
function StatusRing({ state, runs }: { state: RunState; runs: Run[] }) {
  const done = runs.reduce((n, r) => n + r.jobs.done, 0);
  const total = runs.reduce((n, r) => n + r.jobs.total, 0);
  const r = 6.25;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="ci-ring"
      data-state={state}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden
    >
      <circle className="ci-ring-track" cx="8" cy="8" r={r} />
      <circle
        className="ci-ring-fill"
        cx="8"
        cy="8"
        r={r}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - (state === "running" ? done / total : 1))}
      />
      {state === "success" && (
        <path className="ci-ring-mark" d="M5.4 8.2 7.2 10l3.4-3.8" />
      )}
      {state === "failure" && (
        <path className="ci-ring-mark" d="m5.9 5.9 4.2 4.2m0-4.2-4.2 4.2" />
      )}
    </svg>
  );
}

function StalenessNote({ scenario }: { scenario: Scenario }) {
  if (!scenario.ahead) return null;
  return (
    <p className="ci-stale-note">
      {scenario.ahead} local commits aren’t pushed. This is the status of{" "}
      <code>{scenario.sha}</code>, your last push.
    </p>
  );
}

function ClickHint({ source, run }: { source: Source; run: Run }) {
  return (
    <p className="ci-click-hint">
      <ArrowUpRight size={12} aria-hidden />
      Click opens{" "}
      {run.state === "failure"
        ? "the failed"
        : run.state === "running"
          ? "the running"
          : "the latest"}{" "}
      {run.workflow} run on {source === "github" ? "GitHub" : "Gitea"}
    </p>
  );
}

/** Variant 1: the usage ring's popover — a meter per workflow. */
function RingCard({
  scenario,
  source,
}: {
  scenario: Scenario;
  source: Source;
}) {
  const s = summary(scenario.runs)!;
  return (
    <div className="composer-select-popup ci-ring-popup">
      <div className="ci-ring-heading">
        <span>
          {source === "github" ? "GitHub Actions" : "Gitea Actions"} ·{" "}
          {scenario.branch}
        </span>
        <code>{scenario.sha}</code>
      </div>
      {scenario.runs.map((run) => {
        const pace =
          run.state === "failure"
            ? "hot"
            : run.state === "running"
              ? "warn"
              : "ok";
        return (
          <div
            key={run.id}
            className="usage-meter ci-meter"
            data-pace={pace}
            data-state={run.state}
          >
            <div className="usage-meter-top">
              <span>{run.workflow}</span>
              <span className="usage-limit">{STATE_WORD[run.state]}</span>
            </div>
            <div
              className="usage-track"
              role="progressbar"
              aria-label={`${run.workflow} jobs finished`}
              aria-valuemin={0}
              aria-valuemax={run.jobs.total}
              aria-valuenow={run.jobs.done}
            >
              <span
                className="usage-fill"
                style={{ width: `${(run.jobs.done / run.jobs.total) * 100}%` }}
              />
            </div>
            <div className="usage-meter-bottom">
              <span>
                {run.failedJob
                  ? `${run.failedJob} failed`
                  : `${run.jobs.done} of ${run.jobs.total} jobs`}
              </span>
              <span>
                {ago(run.minutes)} · {run.duration}
              </span>
            </div>
          </div>
        );
      })}
      <StalenessNote scenario={scenario} />
      <ClickHint source={source} run={s.target} />
    </div>
  );
}

/** Variant 2: the line-blame tooltip — which commit, who pushed it, how each workflow went. */
function CommitCard({
  scenario,
  source,
}: {
  scenario: Scenario;
  source: Source;
}) {
  const s = summary(scenario.runs)!;
  return (
    <div className="line-blame-tooltip ci-commit-card">
      <div className="blame-location">
        {scenario.branch} · pushed {ago(scenario.pushed)} ·{" "}
        {source === "github" ? "GitHub Actions" : "Gitea Actions"}
      </div>
      <div className="blame-commit">
        <GitCommitHorizontal size={15} />
        <code>{scenario.sha}</code>
        <span>{scenario.message}</span>
      </div>
      <div className="blame-author ci-author">
        <UserRound size={15} />
        <span>{scenario.author}</span>
      </div>
      <ul className="ci-run-list">
        {scenario.runs.map((run) => (
          <li key={run.id} data-state={run.state}>
            <StateIcon state={run.state} size={13} />
            <strong>{run.workflow}</strong>
            <span>{run.failedJob ? `${run.failedJob} failed` : verb(run)}</span>
          </li>
        ))}
      </ul>
      <StalenessNote scenario={scenario} />
      <ClickHint source={source} run={s.target} />
    </div>
  );
}

/** Variant 3: a menu like the branch/model pickers — each row opens its own run. */
function RunMenu({
  scenario,
  source,
  onOpen,
}: {
  scenario: Scenario;
  source: Source;
  onOpen: (run: Run) => void;
}) {
  return (
    <div className="composer-select-popup ci-menu">
      <div className="composer-menu-label ci-menu-label">
        <span>{scenario.branch}</span>
        <code>{scenario.sha}</code>
      </div>
      {scenario.runs.map((run) => (
        <button
          key={run.id}
          type="button"
          className="composer-select-item ci-menu-row"
          onClick={() => onOpen(run)}
        >
          <span className="composer-option-label">
            <span className={`sb-status ci-dot`} data-state={run.state}>
              <i />
            </span>
            {run.workflow}
          </span>
          <small>
            {run.failedJob
              ? `${run.failedJob} · ${ago(run.minutes)}`
              : run.state === "running"
                ? `${run.jobs.done}/${run.jobs.total} jobs`
                : ago(run.minutes)}
          </small>
        </button>
      ))}
      <StalenessNote scenario={scenario} />
      <div className="composer-menu-separator" />
      <p className="ci-menu-foot">
        {source === "github" ? "GitHub Actions" : "Gitea Actions"} · icon opens{" "}
        {summary(scenario.runs)!.target.workflow}
      </p>
    </div>
  );
}

function Indicator({
  variant,
  scenario,
  source,
  onOpen,
}: {
  variant: Variant;
  scenario: Scenario;
  source: Source;
  onOpen: (run: Run) => void;
}) {
  const s = summary(scenario.runs);
  // No CI hooked up: the folder icon stays exactly as it is today.
  if (!s) return <FolderGit2 size={14} />;
  const label = `CI ${STATE_WORD[s.state].toLowerCase()} on ${scenario.branch}${scenario.ahead ? ", for your last push" : ""}. Opens the ${s.target.workflow} run.`;
  const glyph =
    variant === "ring" ? (
      <StatusRing state={s.state} runs={scenario.runs} />
    ) : variant === "card" ? (
      <StateIcon state={s.state} />
    ) : (
      <span className="ci-folder">
        <FolderGit2 size={14} />
        <span className="sb-status ci-dot ci-folder-dot" data-state={s.state}>
          <i />
        </span>
      </span>
    );
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        href={runUrl(source, s.target)}
        delay={150}
        closeDelay={150}
        className="ci-trigger"
        data-stale={scenario.ahead ? true : undefined}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          onOpen(s.target);
        }}
      >
        {glyph}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          className="composer-popup-positioner"
          side="bottom"
          align="start"
          sideOffset={8}
        >
          <PreviewCard.Popup className="ci-popup">
            {variant === "ring" ? (
              <RingCard scenario={scenario} source={source} />
            ) : variant === "card" || variant === "pick" ? (
              <CommitCard scenario={scenario} source={source} />
            ) : (
              <RunMenu scenario={scenario} source={source} onOpen={onOpen} />
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

const VARIANTS: {
  value: Variant;
  label: string;
  from: string;
  note: string;
}[] = [
  {
    value: "pick",
    label: "Your pick · 3 + 2",
    from: "the sidebar’s status dots, with the line-blame card on hover",
    note: "The folder icon stays and gets a status dot on its corner, so the header looks the same as today until CI has something to say. Hovering shows the commit card: which commit ran, who pushed it, and one line per workflow.",
  },
  {
    value: "ring",
    label: "1 · Ring",
    from: "the composer’s context and usage rings",
    note: "The icon is a small ring. It fills up as jobs finish and gets a ✓ or ✗ when the run is done, so you can see how far a build has got without hovering. The hover card has one meter per workflow, like the usage popover.",
  },
  {
    value: "card",
    label: "2 · Commit card",
    from: "the line-blame tooltip in diffs",
    note: "A plain ✓ / ✗ / dashed-circle icon. The hover card shows which commit CI ran on, who pushed it, and one line per workflow. It’s the most “what’s going on in the project” of the three.",
  },
  {
    value: "dot",
    label: "3 · Folder + dot",
    from: "the sidebar’s thread status dots",
    note: "The folder icon stays, with a status dot on its corner like the Relay mark’s activity dot. Running is the hollow ring, same as a pending thread. The hover card is a picker-style menu, and each row opens its own run.",
  },
];

function App() {
  const appearance = useAppearance();
  const [variant, setVariant] = useState<Variant>("pick");
  const [key, setKey] = useState<ScenarioKey>("failing");
  const [source, setSource] = useState<Source>("github");
  const [toast, setToast] = useState<string>();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  const scenario = scenarios[key];
  const open = (run: Run) => setToast(`Would open ${runUrl(source, run)}`);
  const current = VARIANTS.find((v) => v.value === variant)!;
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>CI status</strong>
        <span className="preview-tag">Preview · sample data</span>
        <div className="preview-control">
          <span>Look</span>
          <Segmented<Variant>
            label="Look"
            value={variant}
            onChange={setVariant}
            options={VARIANTS}
          />
        </div>
        <div className="preview-control">
          <span>Pipeline</span>
          <Segmented<ScenarioKey>
            label="Pipeline"
            value={key}
            onChange={setKey}
            options={(Object.keys(scenarios) as ScenarioKey[]).map((k) => ({
              value: k,
              label: scenarios[k].label,
            }))}
          />
        </div>
        <div className="preview-control">
          <span>Project on</span>
          <Segmented<Source>
            label="Project on"
            value={source}
            onChange={setSource}
            options={[
              { value: "github", label: "GitHub" },
              { value: "gitea", label: "Gitea" },
            ]}
          />
        </div>
        <span className="spacer" />
        <Segmented<string>
          label="Colour mode"
          value={appearance.palette.kind}
          onChange={(v) => setMode(v as "light" | "dark")}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
      <div className="app project-app platform-darwin ci-shell">
        <header className="titlebar project-titlebar">
          <div className="project-titlebar-brand">
            <span className="traffic-space" />
            <button
              type="button"
              className="relay-brand-toggle"
              aria-label="Toggle projects"
            >
              <span className="relay-brand-mark">
                <RelayMark />
              </span>
              <strong>Relay</strong>
            </button>
          </div>
          <div className="project-window-title">
            <Indicator
              variant={variant}
              scenario={scenario}
              source={source}
              onOpen={open}
            />
            <span>Relay</span>
            <span className="breadcrumb-slash">/</span>
            <div className="thread-title">
              <strong>Add CI status indicator to PRs</strong>
            </div>
          </div>
          <span className="spacer" />
          <div className="thread-header-actions">
            <button type="button">
              <GitPullRequest size={14} /> Create PR
            </button>
          </div>
        </header>
        <main className="ci-notes">
          <p className="ci-notes-lead">
            Hover the icon left of “Relay” to peek. Click it to open the run.
          </p>
          <h2>{current.label.replace(/^\d · /, "")}</h2>
          <p className="ci-notes-from">Based on {current.from}</p>
          <p>{current.note}</p>
          <ul>
            <li>
              Colours: green passing, yellow building, red failing. Each state
              also has its own shape.
            </li>
            <li>
              The click opens the run that sets the colour: a failed run first,
              then one still running, then the newest.
            </li>
            <li>
              When you have commits CI hasn’t seen, the icon is dimmed and the
              card says so.
            </li>
            <li>
              No animation: while an agent is working, the thinking line is the
              only thing that moves.
            </li>
            <li>
              No CI hooked up: pick “No CI” and the folder icon stays as it is
              today.
            </li>
          </ul>
        </main>
      </div>
      {toast && (
        <div className="ci-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="preview-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
