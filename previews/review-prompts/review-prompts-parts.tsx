// The deep review setup: the app's own fields, with a prompt line per
// reviewer and recent setups by Start.
import type { ReactNode } from "react";
import {
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Plus,
  X,
} from "lucide-react";
import { ModelField } from "../../src/features/agents/ModelField";
import { ComposerSelect } from "../../src/ui/ComposerSelect";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { useCatalogs } from "../../src/features/agents/useCatalogs";
import {
  agentProviders,
  reviewerProviders,
  agentInfo,
} from "../../shared/agents";
import { effortLabels } from "../../shared/settings";
import {
  ago,
  parsePrompt,
  type Lead,
  type Reviewer,
  type Saved,
  type SetupStore,
} from "./review-prompts-data";

const MAX_REVIEWERS = 4;

export function SetupFrame({
  store,
  footer,
  prompt,
}: {
  store: SetupStore;
  /** Left of the hint and Start. */
  footer?: ReactNode;
  prompt: (reviewer: Reviewer, i: number) => ReactNode;
}) {
  const { setup, update, promptFor } = store;
  const count = setup.reviewers.length;
  const setReviewer = (i: number, patch: Partial<Reviewer>) =>
    update({
      reviewers: setup.reviewers.map((r, j) =>
        j === i ? { ...r, ...patch } : r,
      ),
    });
  return (
    <form
      className="project-composer deep-review-composer"
      onSubmit={(e) => {
        e.preventDefault();
        store.start();
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
              {[
                ["Uncommitted changes", <FileDiff size={14} />],
                ["Branch", <GitBranch size={14} />],
                ["Pull request", <GitPullRequest size={14} />],
                ["Commit", <GitCommitHorizontal size={14} />],
              ].map(([label, icon]) => (
                <button
                  key={label as string}
                  type="button"
                  role="radio"
                  aria-checked={label === "Branch"}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
            <div className="composer-tools deep-review-target">
              <span className="deep-review-target-detail">
                <GitBranch size={13} /> main{" "}
                <span className="muted">against</span>
              </span>
              <ComposerSelect
                label="Base branch"
                value="origin/main"
                onChange={() => {}}
                options={[{ value: "origin/main", label: "origin/main" }]}
              />
            </div>
          </div>
        </div>
        <div className="deep-review-field">
          <span className="deep-review-label">Reviewers</span>
          <div className="deep-review-field-body">
            <ol className="deep-review-reviewers rp-reviewers">
              {setup.reviewers.map((reviewer, i) => (
                <li key={i}>
                  <span className="deep-review-slot">{i + 1}</span>
                  <ModelField
                    label={`Reviewer ${i + 1}`}
                    provider={reviewer.provider}
                    providers={reviewerProviders}
                    value={reviewer.choice}
                    onChange={(choice, provider) =>
                      setReviewer(i, {
                        choice,
                        provider,
                        // Prompts belong to an agent; the new one starts where you left it.
                        ...(provider !== reviewer.provider && {
                          prompt: promptFor(provider),
                        }),
                      })
                    }
                  />
                  {prompt(reviewer, i)}
                  {count > 1 && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove reviewer ${i + 1}`}
                      onClick={() =>
                        update({
                          reviewers: setup.reviewers.filter((_, j) => j !== i),
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
                onClick={() => {
                  const last = setup.reviewers[count - 1]!;
                  update({
                    reviewers: [
                      ...setup.reviewers,
                      {
                        ...structuredClone(last),
                        prompt: promptFor(last.provider),
                      },
                    ],
                  });
                }}
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
              providers={agentProviders}
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
      />
      <div className="composer-tools">
        {footer}
        <span className="spacer" />
        <span className="deep-review-hint">
          {count} {count === 1 ? "reviewer" : "reviewers"} and a lead
        </span>
        <button type="submit" className="primary deep-review-start">
          Start deep review
        </button>
      </div>
    </form>
  );
}

export function useModelName() {
  const catalogs = useCatalogs();
  return (a: Reviewer | Lead) =>
    catalogs.modelsOf(a.provider)?.find((m) => m.id === a.choice.model)?.name ??
    (a.choice.model || agentInfo(a.provider).defaultModel);
}

/** How a past setup's prompt reads in a line of text. */
function promptText(r: Reviewer) {
  const parsed = parsePrompt(r.provider, r.prompt);
  if (parsed.kind === "native") return undefined;
  const text = parsed.kind === "custom" ? parsed.text : r.prompt.trim();
  return parsed.kind === "custom"
    ? `“${text.length > 40 ? text.slice(0, 40) + "…" : text}”`
    : text;
}

/** Who reviews, who leads, and any prompt that isn't an agent's own review. */
export function useSummary() {
  const name = useModelName();
  return (entry: Saved) => {
    const { reviewers, lead } = entry.setup;
    const effort =
      lead.choice.reasoningEffort && effortLabels[lead.choice.reasoningEffort];
    return {
      models: reviewers.map(name).join(" · "),
      detail: [
        `${name(lead)}${effort ? ` ${effort}` : ""} leads`,
        ...reviewers.map(promptText).filter(Boolean),
      ].join(" · "),
    };
  };
}

/** A past setup in one line and a line of detail. */
export function SavedSummary({ entry }: { entry: Saved }) {
  const { models, detail } = useSummary()(entry);
  return (
    <span className="rp-saved">
      <span className="rp-saved-glyphs" aria-hidden>
        {entry.setup.reviewers.map((r, i) => (
          <ProviderIcon key={i} provider={r.provider} />
        ))}
      </span>
      <span className="rp-saved-text">
        <strong>{entry.name ?? "Naming…"}</strong>
        <small>
          {models} · {detail}
        </small>
      </span>
      <time className="rp-saved-time">{ago(entry.at)}</time>
    </span>
  );
}
