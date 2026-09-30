import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../src/lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeepReviewSetup } from "../../src/components/DeepReview";
import type { Project } from "../../shared/projects";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

const project: Project = {
  id: "p1",
  name: "relay",
  path: "/tmp/relay",
  repository: null,
  added: 0,
};
const setup = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <DeepReviewSetup
        project={project}
        settingsKey="new:p1"
        context={null}
        branch="main"
        changes={2}
        canChoosePR={false}
        busy={false}
        checkoutDisabled={false}
        onStart={async () => true}
      />
    </QueryClientProvider>,
  );

it("opens on the setup last used in the project", () => {
  const codex = {
    provider: "codex",
    choice: { model: "gpt-5.5", reasoningEffort: "high", fast: false },
  };
  store.set(
    "deep-review-setup:p1",
    JSON.stringify({
      kind: "commit",
      base: "",
      reviewers: [codex, codex, codex],
      lead: codex,
      runChecks: false,
    }),
  );
  const html = setup();
  expect(html).toContain("3 reviewers and a lead");
  expect(html).toMatch(
    /aria-checked="true">(?:(?!<\/button>)[^])*Commit<\/button>/,
  );
  expect(html).not.toContain('type="checkbox" checked=""');
});
