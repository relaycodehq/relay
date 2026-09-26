import { useQuery } from "@tanstack/react-query";
import { PreviewCard } from "@base-ui/react/preview-card";
import {
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  FolderGit2,
  GitCommitHorizontal,
  UserRound,
} from "lucide-react";
import { ciSummary, type CiRun, type CiStatus } from "../../shared/ci";
import { api } from "../lib/api";
import { useWindowFocused } from "../lib/window-focus";
import "./ci-status.css";

const ago = (at: number) => {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  return minutes < 1
    ? "just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
};

const STATE_WORD = {
  success: "passing",
  failure: "failing",
  running: "building",
  skipped: "skipped",
} as const;

function RunLine({ run }: { run: CiRun }) {
  const Icon =
    run.state === "success"
      ? CircleCheck
      : run.state === "failure"
        ? CircleX
        : run.state === "running"
          ? CircleDashed
          : CircleMinus;
  return (
    <li data-state={run.state}>
      <Icon size={13} aria-hidden />
      <strong>{run.workflow}</strong>
      <span>
        {run.state === "failure"
          ? run.failedJob
            ? `${run.failedJob} failed ${ago(run.at)}`
            : `Failed ${ago(run.at)}`
          : run.state === "success"
            ? `Passed ${ago(run.at)}`
            : run.state === "running"
              ? `Running · started ${ago(run.at)}`
              : `Skipped ${ago(run.at)}`}
      </span>
    </li>
  );
}

function CommitCard({ status, target }: { status: CiStatus; target: CiRun }) {
  return (
    <div className="line-blame-tooltip ci-card">
      <div className="blame-location">
        {status.branch} · {status.source} Actions
      </div>
      <div className="blame-commit">
        <GitCommitHorizontal size={15} />
        <code title={status.commit.sha}>{status.commit.sha.slice(0, 7)}</code>
        <span>{status.commit.message || "No commit message"}</span>
      </div>
      {status.commit.author && (
        <div className="blame-author ci-card-author">
          <UserRound size={15} />
          <span>{status.commit.author}</span>
        </div>
      )}
      <ul className="ci-card-runs">
        {status.runs.map((run) => (
          <RunLine key={run.workflow} run={run} />
        ))}
      </ul>
      {status.ahead > 0 && (
        <p className="ci-card-stale">
          {status.ahead === 1
            ? "1 newer commit here hasn’t"
            : `${status.ahead} newer commits here haven’t`}{" "}
          run through CI yet.
        </p>
      )}
      <p className="ci-card-hint">
        <ArrowUpRight size={12} aria-hidden />
        Click opens the{" "}
        {target.state === "failure"
          ? "failed"
          : target.state === "running"
            ? "running"
            : "latest"}{" "}
        {target.workflow} run on {status.source}
      </p>
    </div>
  );
}

/**
 * The project's folder icon in the thread header, with a dot for CI on the
 * thread's branch. Hovering shows the commit and each workflow; clicking opens
 * the run that set the colour. No CI, or none readable, leaves the plain icon.
 */
export function CiStatusIcon({
  projectId,
  chatId,
}: {
  projectId: string;
  chatId?: string;
}) {
  const focused = useWindowFocused();
  const query = useQuery({
    queryKey: ["ci-status", projectId, chatId],
    queryFn: () => api.projectCiStatus(projectId, chatId),
    staleTime: 10_000,
    retry: false,
    // Quick while something builds, lazy once it settles, slower still in the background.
    refetchInterval: (q) =>
      (q.state.data && ciSummary(q.state.data.runs)?.state === "running"
        ? 15_000
        : 90_000) * (focused ? 1 : 4),
  });
  const status = query.data;
  const summary = status && ciSummary(status.runs);
  if (!status || !summary)
    return (
      <span className="ci-plain" title={query.error?.message}>
        <FolderGit2 size={14} />
      </span>
    );
  const { state, target } = summary;
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        href={target.url}
        delay={150}
        closeDelay={150}
        className="ci-trigger"
        data-stale={status.ahead > 0 || undefined}
        aria-label={`CI ${STATE_WORD[state]} on ${status.branch}. Opens the ${target.workflow} run.`}
        onClick={(e) => {
          e.preventDefault();
          if (target.url) void api.openExternal(target.url);
        }}
      >
        <FolderGit2 size={14} aria-hidden />
        <span className="sb-status ci-dot" data-state={state}>
          <i />
        </span>
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          className="composer-popup-positioner"
          side="bottom"
          align="start"
          sideOffset={8}
        >
          <PreviewCard.Popup>
            <CommitCard status={status} target={target} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
