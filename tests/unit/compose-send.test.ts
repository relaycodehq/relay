import { expect, it } from "vitest";
import { buildSend, type SendSettings } from "../../shared/compose-send";
import { recipient } from "../../shared/recipient";

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

it("says who answers in `to`, and in the body for desktops that predate it", () => {
  const asked = buildSend(claude, "look");
  expect(asked).toMatchObject({ to: "claude", provider: "claude" });
  const note = buildSend({ ...claude, to: "message" }, " remember this ");
  expect(note).toMatchObject({ to: "message", body: "remember this" });
  // An older desktop, reading only the body, routes both the same.
  for (const { to, ...older } of [asked, note])
    expect(recipient(older)).toBe(to);
});

it("sends a message that names another agent to it, on its Default model", () => {
  const sent = buildSend(claude, "@codex look");
  expect(sent).toMatchObject({
    body: "@codex look",
    to: "codex",
    provider: "codex",
    choice: { model: "", reasoningEffort: "", fast: false },
  });
  expect(sent).not.toHaveProperty("contextWindow");
});
