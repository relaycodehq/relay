// Deep review in a project thread: its setup, the reviewers at work, and the
// lead's findings. See shared/deep-review.ts for how a review runs.
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Plus,
  RotateCcw,
  ScanSearch,
  Telescope,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import {
  applyChatPatch,
  type ChatMessage,
  type Project,
  type ProjectChat as ProjectChatData,
} from "../../shared/projects";
import {
  deepReviewStartSchema,
  MAX_REVIEWERS,
  priorityMeaning,
  type DeepReviewStart,
  type DeepReviewState,
  type Finding,
  type ReviewAgent,
  type ReviewTarget,
} from "../../shared/deep-review";
import { effortLabels, findClaudeModel } from "../../shared/settings";
import { savedRuntimeMode } from "../../shared/agent-modes";
import type { PullRef } from "../../shared/types";
import type { ProjectFileLink } from "../lib/project-file-links";
import { api } from "../lib/api";
import { FileEntryIcon, RichText } from "./ui";
import { AgentTurn } from "./AgentTurn";
import { ModelField } from "./ModelField";
import { ComposerSelect } from "./ComposerSelect";
import { ProviderIcon } from "./ComposerModelPicker";
import { useCodexModels } from "../lib/useCodexModels";
import { ProjectPullPicker } from "./ProjectPullPicker";
import { ProjectBranchPicker } from "./ProjectBranchPicker";
import "./deep-review.css";

const claudeModelsQuery = {
  queryKey: ["claude-models"],
  queryFn: () => api.claudeModels(),
  staleTime: Infinity,
};
function useClaudeModels() {
  const query = useQuery(claudeModelsQuery);
  return query.isError ? [] : query.data;
}
/** Names an agent by its model, as the pickers do. */
function useAgentName() {
  const claude = useClaudeModels();
  const codex = useCodexModels().models;
  return (agent: ReviewAgent) =>
    agent.provider === "codex"
      ? (codex.find((m) => m.id === agent.choice.model)?.name ??
        (agent.choice.model || "Codex default"))
      : (findClaudeModel(claude, agent.choice.model)?.name ??
        (agent.choice.model || "Claude default"));
}
const effortName = (agent: ReviewAgent) =>
  agent.choice.reasoningEffort
    ? effortLabels[agent.choice.reasoningEffort]
    : "Default";
const nativeReview = (agent: ReviewAgent) =>
  agent.provider === "codex" ? "Codex /review" : "/code-review";

// ——— Setup ———

const claudeAgent = (reasoningEffort: "high" | "xhigh"): ReviewAgent => ({
  provider: "claude",
  // The Opus model fills in once Claude lists its models.
  choice: { model: "", reasoningEffort, fast: false },
});
const codexAgent = (model: string): ReviewAgent => ({
  provider: "codex",
  choice: { model, reasoningEffort: "high", fast: false },
});
/** The first two are the default pair; Add reviewer takes the next one. */
const lineup = [
  claudeAgent("high"),
  codexAgent("gpt-5.6-sol"),
  codexAgent("gpt-5.5"),
  claudeAgent("xhigh"),
];
interface Setup {
  kind: ReviewTarget["kind"];
  base: string;
  reviewers: ReviewAgent[];
  lead: ReviewAgent;
  runChecks: boolean;
}
const setupKey = (projectId: string) => "deep-review-setup:" + projectId;
function savedSetup(projectId: string): Setup | undefined {
  try {
    const saved = JSON.parse(
      localStorage.getItem(setupKey(projectId)) || "null",
    );
    const parsed = deepReviewStartSchema
      .pick({ reviewers: true, lead: true, runChecks: true })
      .safeParse(saved);
    if (!parsed.success) return;
    return {
      ...parsed.data,
      kind: ["uncommitted", "branch", "pr", "commit"].includes(saved.kind)
        ? saved.kind
        : "uncommitted",
      base: typeof saved.base === "string" ? saved.base : "",
    };
  } catch {
    return;
  }
}

/** Replaces the composer in a new deep review thread. */
export function DeepReviewSetup({
  project,
  context,
  branch,
  changes,
  canChoosePR,
  busy,
  checkoutDisabled,
  onStart,
}: {
  project: Project;
  /** The thread's context buttons, as the composer shows them. */
  context: ReactNode;
  branch?: string;
  /** Uncommitted files in the checkout. */
  changes: number;
  canChoosePR: boolean;
  busy: boolean;
  checkoutDisabled: boolean;
  onStart: (config: DeepReviewStart) => Promise<void>;
}) {
  const claudeModels = useClaudeModels();
  const [setup, setSetup] = useState<Setup>(
    () =>
      savedSetup(project.id) ?? {
        kind: "uncommitted",
        base: "",
        reviewers: lineup.slice(0, 2),
        lead: claudeAgent("high"),
        runChecks: true,
      },
  );
  const [touched, setTouched] = useState(() => !!savedSetup(project.id));
  const [pull, setPull] = useState<PullRef | null>(null);
  const [commit, setCommit] = useState("");
  const [focus, setFocus] = useState(
    () => localStorage.getItem("deep-review-focus:" + project.id) ?? "",
  );
  const update = (patch: Partial<Setup>) => {
    setTouched(true);
    setSetup((s) => ({ ...s, ...patch }));
  };
  useEffect(() => {
    if (touched)
      localStorage.setItem(setupKey(project.id), JSON.stringify(setup));
  }, [project.id, setup, touched]);
  useEffect(() => {
    localStorage.setItem("deep-review-focus:" + project.id, focus);
  }, [project.id, focus]);
  // Until someone picks otherwise, Claude reviews and leads with Opus.
  useEffect(() => {
    const opus = claudeModels?.find((m) => /opus/i.test(`${m.id} ${m.name}`));
    if (touched || !opus) return;
    const withOpus = (a: ReviewAgent) =>
      a.provider === "claude" && !a.choice.model
        ? { ...a, choice: { ...a.choice, model: opus.id } }
        : a;
    setSetup((s) => ({
      ...s,
      reviewers: s.reviewers.map(withOpus),
      lead: withOpus(s.lead),
    }));
  }, [claudeModels, touched]);
  const branches = useQuery({
    queryKey: ["project-branches", project.id],
    queryFn: () => api.projectBranches(project.id),
    enabled: setup.kind === "branch",
  });
  const commits = useQuery({
    queryKey: ["recent-commits", project.id],
    queryFn: () => api.projectRecentCommits(project.id),
    enabled: setup.kind === "commit",
  });
  const bases = (branches.data?.branches ?? [])
    .filter((b) => !b.current && b.name !== branch)
    .map((b) => b.name);
  const base =
    setup.base && bases.includes(setup.base)
      ? setup.base
      : (["main", "master", "origin/main", "origin/master"].find((b) =>
          bases.includes(b),
        ) ?? bases[0]);
  const chosenCommit = commit || commits.data?.[0]?.sha;
  const target: ReviewTarget | undefined =
    setup.kind === "uncommitted"
      ? changes
        ? { kind: "uncommitted" }
        : undefined
      : setup.kind === "branch"
        ? base && branch
          ? { kind: "branch", base }
          : undefined
        : setup.kind === "pr"
          ? pull
            ? { kind: "pr", ref: pull }
            : undefined
          : chosenCommit
            ? { kind: "commit", sha: chosenCommit }
            : undefined;
  async function start() {
    if (!target || busy) return;
    // The lead works on fixes the way the composer was last set for new threads.
    let runtimeMode = savedRuntimeMode(undefined);
    try {
      const composer = JSON.parse(
        localStorage.getItem(`composer-settings:new:${project.id}`) || "null",
      );
      runtimeMode = savedRuntimeMode(composer?.runtimeMode);
    } catch {
      // Keep the default.
    }
    await onStart({
      target,
      reviewers: setup.reviewers,
      lead: setup.lead,
      runChecks: setup.runChecks,
      focus: focus.trim(),
      runtimeMode,
    });
  }
  const targets: {
    kind: ReviewTarget["kind"];
    label: string;
    icon: ReactNode;
  }[] = [
    {
      kind: "uncommitted",
      label: "Uncommitted changes",
      icon: <FileDiff size={14} />,
    },
    { kind: "branch", label: "Branch", icon: <GitBranch size={14} /> },
    { kind: "pr", label: "Pull request", icon: <GitPullRequest size={14} /> },
    {
      kind: "commit",
      label: "Commit",
      icon: <GitCommitHorizontal size={14} />,
    },
  ];
  const count = setup.reviewers.length;
  return (
    <div className="thread-compose-wrap">
      <div className="thread-context-controls">
        {context}
        <ProjectBranchPicker
          projectId={project.id}
          branch={branch}
          disabled={checkoutDisabled || busy}
        />
      </div>
      <form
        className="project-composer deep-review-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <div className="deep-review-setup">
          <div className="deep-review-field">
            <span className="deep-review-label">Review</span>
            <div className="deep-review-field-body">
              <div
                className="deep-review-targets"
                role="radiogroup"
                aria-label="What to review"
              >
                {targets.map((t) => (
                  <button
                    key={t.kind}
                    type="button"
                    role="radio"
                    aria-checked={t.kind === setup.kind}
                    onClick={() => update({ kind: t.kind })}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="composer-tools deep-review-target">
                {setup.kind === "uncommitted" && (
                  <span className="deep-review-target-detail">
                    {changes
                      ? `${changes} ${changes === 1 ? "file" : "files"} changed${branch ? ` on ${branch}` : ""}`
                      : "No uncommitted changes to review"}
                  </span>
                )}
                {setup.kind === "branch" &&
                  (!branch ? (
                    <span className="deep-review-target-detail">
                      Check out the branch to review first
                    </span>
                  ) : (
                    <>
                      <span className="deep-review-target-detail">
                        <GitBranch size={13} /> {branch}
                        <span className="muted">against</span>
                      </span>
                      {base ? (
                        <ComposerSelect
                          label="Base branch"
                          value={base}
                          onChange={(value) => update({ base: value })}
                          options={bases.map((b) => ({ value: b, label: b }))}
                        />
                      ) : (
                        <span className="muted">
                          {branches.isPending
                            ? "Loading branches…"
                            : "no other branch"}
                        </span>
                      )}
                    </>
                  ))}
                {setup.kind === "pr" &&
                  (canChoosePR ? (
                    <ProjectPullPicker
                      project={project}
                      selected={pull}
                      onSelect={setPull}
                      placement="bottom"
                    />
                  ) : (
                    <span className="deep-review-target-detail">
                      Connect your Gitea account to review pull requests
                    </span>
                  ))}
                {setup.kind === "commit" &&
                  (chosenCommit ? (
                    <ComposerSelect
                      label="Commit"
                      value={chosenCommit}
                      onChange={setCommit}
                      options={(commits.data ?? []).map((c) => ({
                        value: c.sha,
                        label: `${c.sha.slice(0, 7)} ${c.subject}`,
                      }))}
                    />
                  ) : (
                    <span className="deep-review-target-detail">
                      {commits.isPending
                        ? "Loading commits…"
                        : "No commits yet"}
                    </span>
                  ))}
              </div>
            </div>
          </div>
          <div className="deep-review-field">
            <span className="deep-review-label">Reviewers</span>
            <div className="deep-review-field-body">
              <ol className="deep-review-reviewers">
                {setup.reviewers.map((reviewer, i) => (
                  <li key={i}>
                    <span className="deep-review-slot">{i + 1}</span>
                    <ModelField
                      label={`Reviewer ${i + 1}`}
                      provider={reviewer.provider}
                      value={reviewer.choice}
                      onChange={(choice, provider) =>
                        update({
                          reviewers: setup.reviewers.map((r, j) =>
                            j === i ? { provider, choice } : r,
                          ),
                        })
                      }
                    />
                    <span
                      className="deep-review-native"
                      title="Runs the agent's own review"
                    >
                      <ScanSearch size={12} />
                      {nativeReview(reviewer)}
                    </span>
                    <span className="spacer" />
                    {count > 1 && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove reviewer ${i + 1}`}
                        onClick={() =>
                          update({
                            reviewers: setup.reviewers.filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                      >
                        <X size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {count < MAX_REVIEWERS && (
                <button
                  type="button"
                  className="text-button deep-review-add"
                  onClick={() =>
                    update({
                      reviewers: [...setup.reviewers, lineup[count]!],
                    })
                  }
                >
                  <Plus size={13} /> Add reviewer
                </button>
              )}
            </div>
          </div>
          <div className="deep-review-field">
            <span className="deep-review-label">Lead</span>
            <div className="deep-review-field-body deep-review-lead">
              <ModelField
                label="Lead"
                provider={setup.lead.provider}
                value={setup.lead.choice}
                onChange={(choice, provider) =>
                  update({ lead: { provider, choice } })
                }
              />
              <span className="deep-review-note">
                Merges and verifies the findings, then fixes them with you.
              </span>
              <label className="deep-review-check">
                <input
                  type="checkbox"
                  checked={setup.runChecks}
                  onChange={(e) => update({ runChecks: e.target.checked })}
                />
                Can run tests to verify
              </label>
            </div>
          </div>
        </div>
        <textarea
          className="composer-prompt-input deep-review-focus"
          aria-label="What to focus on"
          placeholder="Anything to focus on? Optional, e.g. the queue changes, security…"
          value={focus}
          maxLength={4000}
          onChange={(e) => setFocus(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void start();
            }
          }}
        />
        <div className="composer-tools">
          <span className="deep-review-hint">
            {count} {count === 1 ? "reviewer" : "reviewers"} and a lead · runs
            on your plan usage
          </span>
          <span className="spacer" />
          <button
            type="submit"
            className="primary deep-review-start"
            disabled={!target || busy}
          >
            Start deep review
          </button>
        </div>
      </form>
    </div>
  );
}

// ——— In the thread ———

function AgentChip({ agent, name }: { agent: ReviewAgent; name: string }) {
  return (
    <span className="deep-review-agent">
      <ProviderIcon provider={agent.provider} />
      {name}
      <span className="muted">{effortName(agent)}</span>
    </span>
  );
}

/** The request, shown as your message with what it covers and who works on it. */
export function DeepReviewRequest({
  message,
  state,
}: {
  message: ChatMessage;
  state: DeepReviewState;
}) {
  const name = useAgentName();
  const { scope } = state;
  return (
    <article
      className="project-message user"
      data-message-id={message.id}
      aria-label="Your message"
    >
      <header>
        <strong>{message.author ?? "You"}</strong>
        <time>
          {new Date(message.created).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </header>
      <div className="markdown">
        <div className="deep-review-request">
          <div className="deep-review-request-title">
            <ScanSearch size={15} />
            <strong>Deep review</strong>
            <span>{scope.label}</span>
            {scope.title && <span className="muted">{scope.title}</span>}
            {scope.stats && (scope.stats.additions || scope.stats.deletions) ? (
              <span className="diff-stat">
                <span className="diff-stat-add">+{scope.stats.additions}</span>
                <span className="diff-stat-del">−{scope.stats.deletions}</span>
              </span>
            ) : null}
          </div>
          <div className="deep-review-request-agents">
            {state.reviewers.map((r) => (
              <AgentChip key={r.chatId} agent={r} name={name(r)} />
            ))}
            <span className="deep-review-arrow" aria-label="then">
              →
            </span>
            <AgentChip agent={state.lead} name={name(state.lead)} />
          </div>
          {state.focus && <p>{state.focus}</p>}
        </div>
      </div>
    </article>
  );
}

/** A reviewer's thread, kept fresh like the main one. */
function useReviewerThread(chatId: string, live: boolean) {
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: ["project-chat", chatId],
    queryFn: async () => {
      const previous = qc.getQueryData<ProjectChatData>([
        "project-chat",
        chatId,
      ]);
      const known = previous
        ? Object.fromEntries(previous.messages.map((m) => [m.id, m.version]))
        : undefined;
      return applyChatPatch(await api.projectChat(chatId, known), previous);
    },
    refetchInterval: (query) =>
      live &&
      (!query.state.data?.messages.some((m) => m.role === "assistant") ||
        query.state.data.messages.some((m) => m.status === "streaming"))
        ? 1000
        : false,
  });
  const [updates, setUpdates] = useState<Record<string, ChatMessage>>({});
  useEffect(
    () =>
      api.onProjectChat((e) => {
        if (e.chatId !== chatId) return;
        setUpdates((old) => ({ ...old, [e.message.id]: e.message }));
        if (e.message.status !== "streaming")
          void qc.invalidateQueries({ queryKey: ["project-chat", chatId] });
      }),
    [chatId, qc],
  );
  return useMemo(() => {
    const byId = new Map((history.data?.messages ?? []).map((m) => [m.id, m]));
    for (const m of Object.values(updates))
      if (!byId.has(m.id) || byId.get(m.id)!.version <= m.version)
        byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => a.created - b.created);
  }, [history.data, updates]);
}

function ReviewerPane({
  number,
  agent,
  chatId,
  live,
  projectRoot,
  onOpenFile,
}: {
  number: number;
  agent: ReviewAgent;
  chatId: string;
  live: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const name = useAgentName();
  const messages = useReviewerThread(chatId, live);
  const answer = [...messages].reverse().find((m) => m.role === "assistant");
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  // Like the main thread: stay at the end unless you scrolled up to read.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (follow.current && scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    observer.observe(column.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <section
      className="deep-review-pane"
      aria-label={`Reviewer ${number}: ${name(agent)}`}
    >
      <header>
        <ProviderIcon provider={agent.provider} />
        <strong>{name(agent)}</strong>
        <span className="muted">{effortName(agent)}</span>
        <span className="spacer" />
        {answer?.status === "complete" && (
          <span className="deep-review-pane-status done">
            <CircleCheck size={13} /> Done
          </span>
        )}
        {(answer?.status === "failed" || answer?.status === "cancelled") && (
          <span className="deep-review-pane-status">
            {answer.status === "cancelled" ? "Stopped" : "Didn't finish"}
          </span>
        )}
      </header>
      <div
        className="deep-review-pane-thread"
        ref={scroll}
        onScroll={() => {
          const e = scroll.current!;
          follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 40;
        }}
      >
        <div ref={column}>
          {messages.map((m) =>
            m.role === "user" ? (
              <article className="project-message user" key={m.id}>
                <header>
                  <strong>You</strong>
                  <span className="muted">via Deep review</span>
                </header>
                <div className="markdown deep-review-pane-prompt">
                  <p>{m.body.replace(/^@(codex|claude)\s+/i, "")}</p>
                </div>
              </article>
            ) : (
              <article className="project-message assistant" key={m.id}>
                <header>
                  <strong>
                    <ProviderIcon provider={m.provider} />
                    {m.provider === "codex" ? "Codex" : "Claude"}
                  </strong>
                  <time>
                    {new Date(m.created).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </header>
                <AgentTurn
                  message={m}
                  projectRoot={projectRoot}
                  onOpenFile={onOpenFile}
                  onChanges={() => {}}
                />
                {m.body.trim() && (
                  <RichText
                    text={m.body}
                    projectRoot={projectRoot}
                    onOpenFile={onOpenFile}
                  />
                )}
                {m.status === "cancelled" && (
                  <p className="muted" role="status">
                    Stopped · partial output kept
                  </p>
                )}
                {m.error && m.status !== "cancelled" && (
                  <p role="status" className="chat-message-error">
                    {m.error}
                  </p>
                )}
              </article>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

/** The reviewers side by side, folded away once the lead has reported. */
export function DeepReviewCouncil({
  state,
  hasLead,
  busy,
  projectRoot,
  onOpenFile,
  onResume,
}: {
  state: DeepReviewState;
  /** The lead has answered at least once. */
  hasLead: boolean;
  busy: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onResume: () => void;
}) {
  const name = useAgentName();
  const settled = state.status === "done";
  const [open, setOpen] = useState(!settled);
  useEffect(() => {
    if (settled) setOpen(false);
  }, [settled]);
  const count = state.reviewers.length;
  const kept = state.report?.findings.length;
  return (
    <section className="deep-review-council" aria-label="Reviewers">
      <button
        type="button"
        className="deep-review-council-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Telescope size={14} />
        <strong>Council</strong>
        <span>
          {count} {count === 1 ? "reviewer" : "reviewers"}
          {state.status === "reviewing"
            ? " at work"
            : kept !== undefined
              ? ` · ${kept} ${kept === 1 ? "finding" : "findings"} kept`
              : ""}
        </span>
        <span className="deep-review-council-glyphs">
          {state.reviewers.map((r) => (
            <ProviderIcon key={r.chatId} provider={r.provider} />
          ))}
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="deep-review-grid" data-count={count}>
          {state.reviewers.map((r, i) => (
            <ReviewerPane
              key={r.chatId}
              number={i + 1}
              agent={r}
              chatId={r.chatId}
              live={state.status === "reviewing"}
              projectRoot={projectRoot}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
      {!hasLead &&
        (state.status === "stopped" || state.status === "failed") && (
          <div className="deep-review-stopped" role="status">
            <span>
              {state.status === "stopped"
                ? "Review stopped."
                : "No reviewer finished, so the lead has nothing to check."}
            </span>
            <button
              type="button"
              className="resume-answer"
              disabled={busy}
              onClick={onResume}
            >
              <RotateCcw size={13} />
              {state.status === "stopped" ? "Resume review" : "Try again"}
            </button>
          </div>
        )}
      {state.status === "leading" && !hasLead && (
        <p className="muted deep-review-handover">
          Handing over to {name(state.lead)}…
        </p>
      )}
    </section>
  );
}

const findingRow = (chatId: string, id: string) =>
  document.getElementById(`finding-${chatId}-${id}`);

/** A finding's priority; in the lead's summary it points at the finding's row. */
function PriorityTag({
  finding,
  chatId,
  linked,
}: {
  finding: Finding;
  chatId: string;
  linked?: boolean;
}) {
  if (!linked)
    return (
      <span
        className="deep-review-priority"
        data-priority={finding.priority}
        title={priorityMeaning[finding.priority]}
      >
        {finding.priority}
      </span>
    );
  return (
    <button
      type="button"
      className="deep-review-priority"
      data-priority={finding.priority}
      title={`${finding.title} · ${priorityMeaning[finding.priority]}`}
      onMouseEnter={() =>
        findingRow(chatId, finding.id)?.setAttribute("data-hover", "")
      }
      onMouseLeave={() =>
        findingRow(chatId, finding.id)?.removeAttribute("data-hover")
      }
      onClick={() =>
        findingRow(chatId, finding.id)?.scrollIntoView({
          block: "nearest",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        })
      }
    >
      {finding.priority}
    </button>
  );
}

/** Shows `F1` in the lead's summary as that finding's priority. */
export function findingCode(chatId: string, findings: Finding[]) {
  return (value: string) => {
    const finding = findings.find((f) => f.id === value);
    return finding ? (
      <PriorityTag finding={finding} chatId={chatId} linked />
    ) : undefined;
  };
}

/** The lead's findings, each with its files, to fix all or some of. */
export function DeepReviewReport({
  chatId,
  state,
  busy,
  onFix,
  onStatus,
  onOpenFile,
}: {
  chatId: string;
  state: DeepReviewState;
  busy: boolean;
  onFix: (findings: Finding[]) => void;
  onStatus: (id: string, status: "open" | "dismissed") => void;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const findings = state.report?.findings ?? [];
  const statusOf = (id: string) => state.statuses?.[id] ?? "open";
  const open = findings.filter((f) => statusOf(f.id) === "open");
  // The urgent ones start ticked.
  const [selected, setSelected] = useState<string[]>(() =>
    open.filter((f) => f.priority <= "P1").map((f) => f.id),
  );
  const chosen = open.filter((f) => selected.includes(f.id));
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  const fix = (list: Finding[]) => {
    setSelected((s) => s.filter((id) => !list.some((f) => f.id === id)));
    onFix(list);
  };
  const dropped = state.report?.dropped ?? [];
  if (!findings.length && !dropped.length) return null;
  return (
    <div className="deep-review-report">
      {findings.length > 0 && (
        <section className="deep-review-tray" aria-label="Findings">
          <ol className="deep-review-tasks">
            {findings.map((f) => {
              const status = statusOf(f.id);
              return (
                <li
                  key={f.id}
                  id={`finding-${chatId}-${f.id}`}
                  className="deep-review-task"
                  data-status={status}
                >
                  <label className="deep-review-task-head" title={f.check}>
                    {status === "fixed" ? (
                      <CircleCheck
                        size={15}
                        className="deep-review-task-fixed"
                        aria-label="Fixed"
                      />
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`Fix ${f.title}`}
                        checked={status === "open" && selected.includes(f.id)}
                        disabled={status !== "open" || busy}
                        onChange={() => toggle(f.id)}
                      />
                    )}
                    <PriorityTag finding={f} chatId={chatId} />
                    <span className="deep-review-task-title">{f.title}</span>
                    {status === "fixing" && (
                      <span className="deep-review-status">Fixing…</span>
                    )}
                    {status === "dismissed" && (
                      <span className="deep-review-status">
                        Dismissed
                        <button
                          type="button"
                          className="text-button"
                          onClick={(e) => {
                            e.preventDefault();
                            onStatus(f.id, "open");
                          }}
                        >
                          <Undo2 size={12} /> Undo
                        </button>
                      </span>
                    )}
                    <span
                      className="deep-review-found-by"
                      title={`Found by reviewer ${f.reviewers.join(", ")}`}
                    >
                      {f.reviewers.map((n) => {
                        const reviewer = state.reviewers[n - 1];
                        return reviewer ? (
                          <ProviderIcon key={n} provider={reviewer.provider} />
                        ) : null;
                      })}
                      {f.reviewers.length > 0 &&
                        `${f.reviewers.length}/${state.reviewers.length}`}
                    </span>
                    {status === "open" && (
                      <button
                        type="button"
                        className="icon-button deep-review-dismiss"
                        aria-label={`Dismiss ${f.title}`}
                        title="Dismiss"
                        disabled={busy}
                        onClick={(e) => {
                          e.preventDefault();
                          onStatus(f.id, "dismissed");
                        }}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </label>
                  {f.files.length > 0 && (
                    <ul className="deep-review-task-files">
                      {f.files.map((file) => (
                        <li key={`${file.path}:${file.line ?? ""}`}>
                          <button
                            type="button"
                            className="deep-review-task-file"
                            title={`${file.path}${file.line ? `:${file.line}` : ""}`}
                            onClick={() =>
                              onOpenFile({
                                path: file.path,
                                ...(file.line ? { line: file.line } : {}),
                                directory: false,
                              })
                            }
                          >
                            <FileEntryIcon path={file.path} directory={false} />
                            <span className="deep-review-task-file-name">
                              {file.path.split("/").pop()}
                            </span>
                            {file.line && (
                              <span className="deep-review-task-file-line">
                                L{file.line}
                              </span>
                            )}
                            <span className="deep-review-task-file-dir">
                              {file.path.split("/").slice(0, -1).join("/")}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
          <footer>
            <span className="spacer" />
            <button
              type="button"
              disabled={!chosen.length || busy}
              onClick={() => fix(chosen)}
            >
              Fix selected{chosen.length ? ` (${chosen.length})` : ""}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!open.length || busy}
              onClick={() => fix(open)}
            >
              <Wrench size={14} />
              {!open.length
                ? "Fix all"
                : open.length < findings.length
                  ? `Fix the other ${open.length}`
                  : `Fix all ${open.length}`}
            </button>
          </footer>
        </section>
      )}
      {dropped.length > 0 && (
        <details className="deep-review-dropped">
          <summary>
            <ChevronRight size={13} /> Not kept · {dropped.length}
          </summary>
          <ul>
            {dropped.map((d, i) => (
              <li key={i}>
                <span className="deep-review-dropped-title">{d.title}</span>
                {d.reason && <span className="muted">{d.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
