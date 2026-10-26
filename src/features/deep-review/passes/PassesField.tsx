import { useState } from "react";
import { MAX_REVIEWERS, passCount } from "../../../../shared/deep-review";
import { formatLines, leftOut, readLines } from "../../../../shared/review-passes";
import { PASS_LINES, passPerFolder } from "../../../../shared/suggest-passes";
import type { ReviewPasses } from "./useReviewPasses";

/**
 * How a review is split into passes, each reviewed by every reviewer in
 * turn, and why: one line a pass, written out to edit.
 */
export function PassesField({
  passes: p,
  reviewers,
}: {
  passes: ReviewPasses;
  reviewers: number;
}) {
  const [editing, setEditing] = useState(false);
  if (!p.files) return null;
  const split = p.passes.length > 0;
  return (
    <div className="deep-review-field">
      <span className="deep-review-label">Passes</span>
      <div className="deep-review-field-body">
        {editing ? (
          <textarea
            className="deep-review-passes-text"
            aria-label="Passes, one a line"
            rows={Math.max(3, p.passes.length + 1)}
            value={p.text}
            spellCheck={false}
            onChange={(e) => p.write(e.target.value)}
          />
        ) : (
          split && <PassList passes={p} />
        )}
        <PassNotes passes={p} reviewers={reviewers} />
        <div className="deep-review-pass-actions">
          {split && (
            <label className="deep-review-check">
              <input
                type="checkbox"
                checked={p.seamsOn}
                onChange={(e) => p.setSeams(e.target.checked)}
              />
              Then a pass on how they fit together
            </label>
          )}
          <span className="spacer" />
          {p.edited && (
            <button type="button" className="text-button" onClick={p.reset}>
              Suggested
            </button>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              p.setPasses(split ? [] : passPerFolder(p.files!));
              setEditing(false);
            }}
          >
            {split ? "One pass" : "Split"}
          </button>
          {split && (
            <button
              type="button"
              className="text-button"
              onClick={() => setEditing(!editing)}
            >
              {editing ? "Done" : "Edit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PassList({ passes: p }: { passes: ReviewPasses }) {
  return (
    <ol className="deep-review-passes">
      {p.passes.map((pass, i) => (
        <li key={i}>
          <span className="deep-review-slot">{i + 1}</span>
          <span className="deep-review-pass-paths" title={pass.join(" ")}>
            {pass.join(" ")}
          </span>
          <span className="deep-review-note">
            {formatLines(p.coverage?.passes[i]?.lines ?? 0)}
          </span>
        </li>
      ))}
      {p.seams && (
        <li>
          <span className="deep-review-slot">{p.passes.length + 1}</span>
          <span className="deep-review-pass-paths muted">
            How they fit together, over the whole change
          </span>
        </li>
      )}
    </ol>
  );
}

/** Why it's split or not, what's left out, and what no pass reviews. */
function PassNotes({
  passes: p,
  reviewers,
}: {
  passes: ReviewPasses;
  reviewers: number;
}) {
  const files = p.files ?? [];
  const skipped = files
    .filter((f) => leftOut(f.path))
    .reduce((n, f) => n + f.additions + f.deletions, 0);
  const missed = p.coverage?.missed.map((f) => f.path) ?? [];
  const runs = reviewers * passCount(p);
  return (
    <>
      <span className="deep-review-note">
        {why(
          p,
          files.reduce((n, f) => n + readLines(f), 0),
          reviewers,
        )}
        {skipped > 0 &&
          ` Lockfiles and fixtures left out: ${formatLines(skipped)}.`}
      </span>
      {missed.length > 0 && (
        <span className="deep-review-note deep-review-warning">
          No pass covers {missed.slice(0, 3).join(", ")}
          {missed.length > 3 && ` and ${missed.length - 3} more`}.
        </span>
      )}
      {runs > MAX_REVIEWERS && (
        <span className="deep-review-note deep-review-warning">
          {reviewers} reviewers in {passCount(p)} passes is more than the{" "}
          {MAX_REVIEWERS} runs a review takes.
        </span>
      )}
    </>
  );
}

/** Why the review runs in passes, or doesn't. */
function why(p: ReviewPasses, total: number, reviewers: number) {
  const lines = formatLines(total);
  if (!p.passes.length) return `One pass: ${lines} to read.`;
  const each = `Each of the ${reviewers} reviewers reviews them one after another.`;
  if (p.edited) return `Your split of ${lines}. ${each}`;
  return `${lines} is more than a reviewer reads closely in one go (about ${formatLines(PASS_LINES)}), so it's split. ${each}`;
}
