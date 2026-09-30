// Deep review: type each reviewer's prompt, start from a recent setup.
// Open http://127.0.0.1:5177/previews/review-prompts.html
import "./desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/composer-model-picker.css";
import "../src/components/deep-review.css";
import "./review-prompts.css";
import { initAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import type { Api } from "../shared/types";
import { sampleCursorModels, useSetupStore } from "./review-prompts-data";
import { SetupFrame, useModelName } from "./review-prompts-parts";
import { PromptLine } from "./review-prompts-line";
import { RecentSetups } from "./review-prompts-recent";

initAppearance();
initWindowFocus();

const stubModels = window.relay.agentModels;
Object.assign(window.relay as Partial<Api>, {
  agentModels: (async (provider: string) =>
    provider === "cursor"
      ? sampleCursorModels
      : stubModels(provider as never)) as Api["agentModels"],
});

function Page() {
  const store = useSetupStore(useModelName());
  const setPrompt = (i: number, prompt: string) =>
    store.update({
      reviewers: store.setup.reviewers.map((r, j) =>
        j === i ? { ...r, prompt } : r,
      ),
    });
  return (
    <div className="rp-page">
      <p className="rp-sample">
        Sample data · names come from a stand-in for the helper agent
        <button type="button" className="text-button" onClick={store.reset}>
          Reset
        </button>
      </p>
      <div className="thread-compose-wrap">
        <SetupFrame
          store={store}
          footer={<RecentSetups store={store} />}
          prompt={(reviewer, i) => (
            <PromptLine
              store={store}
              reviewer={reviewer}
              index={i}
              onChange={(p) => setPrompt(i, p)}
            />
          )}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>
  </StrictMode>,
);
