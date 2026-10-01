import { expect, it } from "vitest";
import { buildSend, type SendSettings } from "../../shared/compose-send";

const claude: SendSettings = {
  to: "claude",
  choice: { model: "opus", reasoningEffort: "high", fast: true },
  contextWindow: "200k",
  runtimeMode: "full-access",
  interactionMode: "default",
};

it("sends a council's question in Plan, queued behind a running answer rather than steering it", () => {
  expect(
    buildSend(claude, "plan retries", {
      council: "angles",
      running: { steer: true },
    }),
  ).toMatchObject({
    body: "@claude plan retries",
    interactionMode: "plan",
    ultraplan: "angles",
    delivery: "queue",
    choice: { fast: false },
    contextWindow: "200k",
  });
});

it("asks for no context window on a model with 1M built in", () => {
  const sent = buildSend(
    { ...claude, choice: { ...claude.choice, model: "opus[1m]" } },
    "hi",
  );
  expect(sent).not.toHaveProperty("contextWindow");
});

it("leaves a note unaddressed and an addressed message as written", () => {
  expect(buildSend({ ...claude, to: "message" }, " remember this ").body).toBe(
    "remember this",
  );
  expect(buildSend(claude, "@codex look").body).toBe("@codex look");
});
