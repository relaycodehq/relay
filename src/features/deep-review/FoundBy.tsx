import type { DeepReviewState } from "../../../shared/deep-review";
import { ProviderIcon } from "../agents/ComposerModelPicker";

/** Which of a deep review's reviewers raised something, as glyphs and n/N. */
export function FoundBy({
  numbers,
  reviewers,
  labels,
  verb = "Found by",
}: {
  numbers: number[];
  reviewers: DeepReviewState["reviewers"];
  /** One line per reviewer, for the hover. */
  labels: string[];
  verb?: string;
}) {
  // Outside a deep review there's no one to credit.
  if (!reviewers.length) return null;
  return (
    <span
      className="deep-review-found-by"
      title={[verb, ...numbers.map((n) => labels[n - 1] ?? `${n}.`)].join(
        "\n",
      )}
    >
      {numbers.map((n) => {
        const reviewer = reviewers[n - 1];
        return reviewer ? (
          <ProviderIcon key={n} provider={reviewer.provider} />
        ) : null;
      })}
      {numbers.length > 0 && `${numbers.length}/${reviewers.length}`}
    </span>
  );
}
