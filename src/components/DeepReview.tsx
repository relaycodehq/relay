// Deep review in a project thread: its setup, the reviewers at work, and the
// lead's findings. See shared/deep-review.ts for how a review runs.
import { clock } from "../../shared/waiting";
import { useState } from "react";
import {
  ChevronRight,
  CircleCheck,
  ScanSearch,
  Telescope,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import type { ChatMessage } from "../../shared/projects";
import {
  priorityMeaning,
  type DeepReviewState,
  type Finding,
  type LeadAgent,
  type ReviewAgent,
} from "../../shared/deep-review";
import type { ProjectFileLink } from "../../shared/project-file-links";
import { effortName, useAgentName } from "../lib/useAgentName";
import { useCouncilFold } from "../lib/useCouncilFold";
import { FileEntryIcon } from "./ui";
import { ProviderIcon } from "./ComposerModelPicker";
import { CouncilHalted, CouncilToggle } from "./Council";
import { CouncilMember } from "./CouncilMember";
export { DeepReviewSetup } from "./deep-review/Setup";
import "./deep-review.css";

function AgentChip({
  agent,
  name,
}: {
  agent: ReviewAgent | LeadAgent;
  name: string;
}) {
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
        <time>{clock(message.created)}</time>
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
  const { open, toggle } = useCouncilFold(state.status === "done");
  const count = state.reviewers.length;
  const kept = state.report?.findings.length;
  return (
    <section className="deep-review-council" aria-label="Reviewers">
      <CouncilToggle open={open} onToggle={toggle} members={state.reviewers}>
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
      </CouncilToggle>
      {open && (
        <div className="deep-review-grid" data-count={count}>
          {state.reviewers.map((r, i) => (
            <CouncilMember
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
          <CouncilHalted
            text={
              state.status === "stopped"
                ? "Review stopped."
                : "No reviewer finished, so the lead has nothing to check."
            }
            action={state.status === "stopped" ? "Resume review" : "Try again"}
            busy={busy}
            onResume={onResume}
          />
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
