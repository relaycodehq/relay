import type { PredictionSummary } from "../prediction";
import type { WatchClose, WatchReview, WatchSpendSummary } from "../watch";
import type {
  DeepReviewStart,
  ResumeReview,
  ReviewTarget,
  ReviewSetup,
  SavedReviewSetup,
} from "../deep-review";
import type { FindingStatus } from "../findings";
import type { ChangedFile } from "../review-passes";
import type { CommitSummary } from "../history";
import type { SecondOpinionAgent } from "../second-opinion";

/** Deep reviews, run inside a thread, and second opinions on one answer. */
export interface ProjectCouncilApi {
  startDeepReview(id: string, config: DeepReviewStart): Promise<void>;
  /** The files a deep review of `target` would cover in project `id`, for its setup to split. */
  /** `on`: read where that branch is checked out instead of the project folder. */
  deepReviewFiles(
    id: string,
    target: ReviewTarget,
    on?: string,
  ): Promise<ChangedFile[]>;
  /** What the folder `branch` is checked out in holds for a review to read: its uncommitted files and latest commits. */
  deepReviewFolder(
    id: string,
    branch: string,
  ): Promise<{ changes: number; commits: CommitSummary[] }>;
  /** Asks `agent` for a second opinion on answer `answerId`, in a read-only thread of its own. */
  askSecondOpinion(
    id: string,
    answerId: string,
    agent: SecondOpinionAgent,
  ): Promise<void>;
  /** Sends a finished second opinion, thread `id`, to the agent whose answer it checked. */
  sendSecondOpinion(id: string): Promise<void>;
  /** A short name for a deep review setup, written by a helper agent; null when none could. */
  nameReviewSetup(setup: ReviewSetup): Promise<string | null>;
  /** The setups the deep review sheet lists, for the deep_review tool to pick from. */
  saveReviewSetups(setups: SavedReviewSetup[]): Promise<void>;
  /**
   * Runs the reviewers that didn't finish, then the lead. `slot` runs that
   * reviewer's task again before the lead starts; `lead` hands a stopped
   * review to the lead with the reports that are in.
   */
  resumeDeepReview(id: string, only?: ResumeReview): Promise<void>;
  /** Opens or dismisses a finding an answer in the thread published. */
  setFinding(
    id: string,
    findingId: string,
    status: Extract<FindingStatus, "open" | "dismissed">,
  ): Promise<void>;
  /**
   * Takes a watch note out of its turn; "known" also keeps its topic from
   * coming up again. `read` says its details were open.
   */
  closeWatchNote(
    id: string,
    messageId: string,
    noteId: string,
    how: WatchClose,
    read: boolean,
  ): Promise<void>;
  /** What "Flag what I'd miss" spent this past week, by thread. */
  watchSpend(): Promise<WatchSpendSummary | undefined>;
  /** What the composer's next-message guesses cost this past week, and how often they were sent. */
  predictionSpend(): Promise<PredictionSummary | undefined>;
  /** The composer showed an answer's guess at the next message, or Escape put it away. */
  seePrediction(
    id: string,
    messageId: string,
    how: "shown" | "dismissed",
  ): Promise<void>;
  /** This past week's notes with what was done with each; development builds. */
  watchReview(): Promise<WatchReview>;
  /** Has a helper model grade the notes not graded yet; spends on the helper's account. */
  judgeWatchNotes(): Promise<WatchReview>;
}
