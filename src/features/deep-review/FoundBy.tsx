import type { DeepReviewState } from "../../../shared/deep-review";
import { ProviderIcon } from "../agents/ComposerModelPicker";

/**
 * The reviewers behind the threads that raised something, each once, with
 * the passes it raised it in. A split review runs every reviewer once a
 * pass, pass by pass, so thread `n` is reviewer `(n - 1) % perPass`.
 */
export function creditedReviewers(
  numbers: number[],
  reviewers: DeepReviewState["reviewers"],
) {
  const perPass = reviewers.filter((r) => (r.pass ?? 0) === 0).length;
  const credited = new Map<number, number[]>();
  for (const n of numbers) {
    const thread = reviewers[n - 1];
    if (!thread) continue;
    const slot = (n - 1) % perPass;
    const passes = credited.get(slot) ?? [];
    if (thread.pass !== undefined) passes.push(thread.pass + 1);
    credited.set(slot, passes);
  }
  return {
    perPass,
    credited: [...credited].map(([slot, passes]) => ({ slot, passes })),
  };
}

/** Which of a deep review's reviewers raised something, as glyphs and n/N. */
export function FoundBy({
  numbers,
  reviewers,
  labels,
  verb = "Found by",
}: {
  numbers: number[];
  reviewers: DeepReviewState["reviewers"];
  /** One line per reviewer thread, for the hover. */
  labels: string[];
  verb?: string;
}) {
  // Outside a deep review there's no one to credit.
  if (!reviewers.length) return null;
  const { perPass, credited } = creditedReviewers(numbers, reviewers);
  const lines = credited.map(({ slot, passes }) => {
    const label = labels[slot] ?? `${slot + 1}.`;
    if (!passes.length) return label;
    return `${label} · ${passes.length > 1 ? "passes" : "pass"} ${passes.join(", ")}`;
  });
  return (
    <span className="deep-review-found-by" title={[verb, ...lines].join("\n")}>
      {credited.map(({ slot }) => (
        <ProviderIcon key={slot} provider={reviewers[slot]!.provider} />
      ))}
      {credited.length > 0 && `${credited.length}/${perPass}`}
    </span>
  );
}
