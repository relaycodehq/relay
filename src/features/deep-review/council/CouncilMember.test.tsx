import { expect, it, vi } from "vitest";
vi.mock("../../../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChatMessage } from "../../../../shared/projects";
import { CouncilMember } from "./CouncilMember";

function render(body: string, timing: Partial<ChatMessage> = {}) {
  const client = new QueryClient();
  client.setQueryData(["project-chat", "reviewer"], {
    messages: [
      {
        id: "answer",
        role: "assistant",
        provider: "opencode",
        body,
        status: "complete",
        created: 0,
        ended: 0,
        version: 1,
        ...timing,
      },
    ],
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CouncilMember
        number={1}
        agent={{
          provider: "opencode",
          choice: { model: "opencode/muse", reasoningEffort: "", fast: false },
        }}
        chatId="reviewer"
        live={false}
        projectRoot="/project"
        onOpenFile={() => {}}
      />
    </QueryClientProvider>,
  );
}

it("shows older empty completed runs as missing reports instead of Done", () => {
  const html = render(" \n");
  expect(html).toContain("No report");
  expect(html).toContain("This run ended without a written report.");
  expect(html).not.toContain("status done");
  expect(render("No confirmed findings.")).toContain("status done");
});

it.each(["complete", "cancelled", "failed"] as const)(
  "shows the saved duration for a %s reviewer",
  (status) => {
    const html = render("Report", {
      status,
      created: 1000,
      ended: 82000,
    });
    expect(html).toContain('title="Review duration">1m 21s</span>');
  },
);

it("does not invent a duration for older reviewers without a finish time", () => {
  expect(render("Report", { ended: undefined })).not.toContain(
    "deep-review-pane-time",
  );
});
