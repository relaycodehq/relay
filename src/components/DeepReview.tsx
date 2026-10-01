// Deep review in a project thread: its setup, the reviewers at work, and the
// lead's findings; the parts live in deep-review/. See shared/deep-review.ts
// for how a review runs.
export { DeepReviewCouncil } from "./deep-review/Council";
export { DeepReviewRequest } from "./deep-review/Request";
export { DeepReviewReport } from "./deep-review/Report";
export { findingCode } from "./deep-review/PriorityTag";
export { DeepReviewSetup } from "./deep-review/Setup";
import "./deep-review.css";
