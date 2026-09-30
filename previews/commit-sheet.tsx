// The Commit & push sheet on sample data; the message comes back after a
// moment. Open http://127.0.0.1:5177/previews/commit-sheet.html
import "./desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";
import "../src/components/projects.css";
import { initAppearance } from "../src/lib/appearance";
import { initTypography } from "../src/lib/typography";
import { CommitSheet } from "../src/components/CommitSheet";
import type { WorkingTree } from "../shared/working-tree";

initAppearance();
initTypography();

const branch = "relay/can-you-please-make-it-so-there-is-someh";
const added = (path: string) => ({
  path,
  index: "?",
  worktree: "?",
  conflict: false,
});
const modified = (path: string) => ({
  path,
  index: " ",
  worktree: "M",
  conflict: false,
});
const tree: WorkingTree = {
  head: "83b4f5b",
  branch,
  revision: "1",
  changes: [
    added("previews/review-prompts-data.ts"),
    added("previews/review-prompts-line.tsx"),
    added("previews/review-prompts-parts.tsx"),
    added("previews/review-prompts-recent.tsx"),
    added("previews/review-prompts.css"),
    added("previews/review-prompts.html"),
    modified("src/components/DeepReview.tsx"),
    modified("src/components/deep-review.css"),
    modified("src/lib/review-presets.ts"),
    {
      path: "src/lib/old-review-prompts.ts",
      index: "D",
      worktree: " ",
      conflict: false,
    },
  ],
  upstream: `origin/${branch}`,
  ahead: 0,
  behind: 0,
  pushTarget: `origin/${branch}`,
  pushUrl: "https://example.invalid/sample/relay.git",
  operation: null,
  lines: { additions: 612, deletions: 48 },
  outgoing: [],
};
Object.assign(window.relay, {
  projectCommitMessage: async () => {
    await new Promise((r) => setTimeout(r, 800));
    return "Preview typed reviewer prompts and recent setups for deep review\n\nEach reviewer gets a prompt line like the composer: / for commands, $ for\nCodex skills, or free text. Recent setups sit by Start, named by the\nhelper.";
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <p className="muted" style={{ margin: 0, padding: "6px 12px" }}>
        Sample data
      </p>
      <CommitSheet where="sample" tree={tree} push onClose={() => {}} />
    </QueryClientProvider>
  </StrictMode>,
);
