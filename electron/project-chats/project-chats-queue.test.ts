import { it, expect, vi } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { findExecutable } from "../platform/executables";
import { AgentAccounts, accountFor } from "../agents/accounts";
import { prepareProfile, setProfilesRoot } from "../agents/accounts/profiles";
import {
  root,
  store,
  projects,
  chats,
  projectId,
  events,
  recordEvent,
  waitForChatEvent,
  waitForSummary,
  agentCalls,
  input,
  restart,
  useProjectChats,
  tinyPng,
} from "../../tests/fixtures/project-chats-harness";
vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

useProjectChats();

it("drains queued follow-ups in order and retains a paused queue across restart", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "2600");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex First"));
  const second = input("@codex Second"),
    third = input("@codex Third");
  await chats.send(chat.id, second);
  await chats.send(chat.id, third);
  await chats.send(chat.id, second);
  expect((await chats.get(chat.id)).queue).toHaveLength(2);
  await vi.waitFor(async () =>
    expect(
      (await chats.get(chat.id)).messages.filter(
        (m) => m.role === "assistant" && m.status === "complete",
      ),
    ).toHaveLength(3),
  );
  expect(
    (await chats.get(chat.id)).messages
      .filter((m) => m.role === "user")
      .map((m) => m.body),
  ).toEqual(["@codex First", "@codex Second", "@codex Third"]);
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  await chats.send(chat.id, input("@codex wait for cancellation"));
  const held = input("@codex Held for later");
  await chats.send(chat.id, held);
  await chats.dispose();
  restart((e) => events.push(e));
  expect((await chats.get(chat.id)).queuePaused).toBe(true);
  expect((await chats.get(chat.id)).queue?.[0].input.id).toBe(held.id);
  await chats.queueAction(chat.id, "remove", held.id);
  expect((await chats.get(chat.id)).queue).toHaveLength(0);
});

it("leaves a paused queue paused when Relay sends Claude's wake-up itself", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  const held = input("@codex Held for later");
  await chats.send(chat.id, held);
  await chats.dispose();
  // Kept when Relay closed; sent once it's due after the restart.
  const file = join(root, "chats", chat.id + ".json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.heldWakeups = [{ id: "w", prompt: "Compare", at: Date.now() }];
  await writeFile(file, JSON.stringify(saved));
  restart((e) => events.push(e));
  await (
    chats as unknown as {
      schedule: { fireWakeup(id: string, w: string): Promise<void> };
    }
  ).schedule.fireWakeup(chat.id, "w");
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  const after = await chats.get(chat.id);
  expect(after.queuePaused).toBe(true);
  expect(after.queue?.map((q) => q.input.id)).toEqual([held.id]);
});

/** Fires a thread's planned resume now instead of after the limit lifts. */
const fireLimitResume = (id: string) =>
  (
    chats as unknown as { limits: { fire(id: string): Promise<void> } }
  ).limits.fire(id);

it("resumes an answer a usage limit stopped once the limit lifts, and picks its queue back up", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "1500");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture usage limit"));
  await chats.send(chat.id, input("@codex Queued meanwhile"));
  await vi.waitFor(() =>
    expect(chats.list(projectId)[0].limitResume).toBeDefined(),
  );
  const plan = chats.list(projectId)[0].limitResume!;
  const stopped = await chats.get(chat.id);
  const failed = stopped.messages.at(-1)!;
  expect(failed).toMatchObject({
    status: "failed",
    error: "You've hit your usage limit.",
  });
  expect(plan).toMatchObject({ messageId: failed.id, provider: "codex" });
  // Codex said seconds; the plan keeps milliseconds, ten minutes out.
  expect(plan.at - Date.now()).toBeGreaterThan(9 * 60_000);
  expect(plan.at - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  expect(stopped.queuePaused).toBe(true);
  await chats.dispose();
  restart((e) => events.push(e));
  expect(chats.list(projectId)[0].limitResume).toEqual(plan);
  await fireLimitResume(chat.id);
  await vi.waitFor(async () => {
    const after = await chats.get(chat.id);
    expect(
      after.messages.filter((m) => m.role === "user").map((m) => m.body),
    ).toEqual([
      "@codex fixture usage limit",
      expect.stringMatching(/^@codex Continue from where/),
      "@codex Queued meanwhile",
    ]);
    expect(after.messages.at(-1)?.status).toBe("complete");
  });
  expect(chats.list(projectId)[0].limitResume).toBeUndefined();
  const inputs = (await chats.get(chat.id)).messages.filter(
    (m) => m.role === "user",
  );
  expect(inputs.map((m) => m.resumed)).toEqual([undefined, true, undefined]);
});

it("keeps an answer a usage limit stopped on its account, waiting for the reset, even with another signed in", async () => {
  vi.stubEnv("CODEX_HOME", join(root, "codex-home"));
  setProfilesRoot(join(root, "agent-accounts"));
  await store.update((s) => {
    s.agentAccounts = {
      accounts: [
        { provider: "codex", id: "default", label: "Personal" },
        { provider: "codex", id: "work", label: "Work" },
      ],
    };
  });
  const work = await prepareProfile("codex", "work");
  await writeFile(
    join(work, "auth.json"),
    JSON.stringify({ tokens: { access_token: "work-token" } }),
  );
  new AgentAccounts(store, () => {});
  try {
    const chat = await chats.create(projectId, { kind: "project" });
    await chats.send(chat.id, input("@codex fixture usage limit"));
    await vi.waitFor(() =>
      expect(chats.list(projectId)[0].limitResume).toBeDefined(),
    );
    const after = await chats.get(chat.id);
    expect(after.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(after.accounts?.codex ?? "default").toBe("default");
    expect(accountFor("codex")).toBe("default");
  } finally {
    await store.update((s) => {
      delete s.agentAccounts;
    });
  }
});

it("fails a turn whose agent is signed out with that agent's sign-in offered, and plans no resume", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture codex signed out"));
  await vi.waitFor(async () => {
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("failed");
  });
  const failed = (await chats.get(chat.id)).messages.at(-1)!;
  expect(failed).toMatchObject({
    signIn: "codex",
    error: "Codex is signed out. Sign in again, then resume the answer.",
  });
  expect(chats.list(projectId)[0].limitResume).toBeUndefined();
});

it("plans no resume for a usage limit that says nothing of when it lifts", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture usage limit without reset"));
  await vi.waitFor(async () => {
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("failed");
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
  const failed = (await chats.get(chat.id)).messages.at(-1)!;
  expect(failed).toMatchObject({ error: "You've hit your usage limit." });
  expect(failed.signIn).toBeUndefined();
  expect(chats.list(projectId)[0].limitResume).toBeUndefined();
});

it("drops the planned resume when the thread moves on, and resumes nothing it no longer fits", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture usage limit"));
  await vi.waitFor(() =>
    expect(chats.list(projectId)[0].limitResume).toBeDefined(),
  );
  const plan = chats.list(projectId)[0].limitResume!;
  await chats.setLimitResume(chat.id, false);
  expect(chats.list(projectId)[0].limitResume?.off).toBe(true);
  await chats.setLimitResume(chat.id, true);
  expect(chats.list(projectId)[0].limitResume?.off).toBeUndefined();
  await chats.send(chat.id, input("@codex Something else first"));
  expect(chats.list(projectId)[0].limitResume).toBeUndefined();
  await vi.waitFor(async () => {
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete");
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
  // A plan left over from before, as a save from another build might hold.
  await chats.dispose();
  const file = join(root, "chats", chat.id + ".json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.limitResume = plan;
  await writeFile(file, JSON.stringify(saved));
  restart((e) => events.push(e));
  const before = (await chats.get(chat.id)).messages.length;
  await fireLimitResume(chat.id);
  const after = await chats.get(chat.id);
  expect(after.messages).toHaveLength(before);
  expect(after.limitResume).toBeUndefined();
  expect(chats.hasActiveProject(projectId)).toBe(false);
});

it("holds a Send later message until its time, sends it now on request, and keeps it across restart", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const chat = await chats.create(projectId, { kind: "project" });
  const soon = input("Check the deploy.");
  const scheduled = { ...soon, sendAt: Date.now() + 3_600_000 };
  await chats.send(chat.id, scheduled);
  await chats.send(chat.id, scheduled);
  let saved = await chats.get(chat.id);
  expect(saved.messages).toHaveLength(0);
  expect(saved.scheduled).toHaveLength(1);
  expect(saved.scheduled?.[0]).toMatchObject({ input: { id: soon.id } });
  expect(saved.scheduled?.[0].input.sendAt).toBeUndefined();
  expect(chats.list(projectId)[0].nextSend).toBe(saved.scheduled?.[0].at);
  // A thread started with Send later stays in the sidebar while it waits.
  expect(chats.list(projectId)[0].empty).toBe(false);
  // Fire the timer scheduling itself armed, with no launch-time rearming to rescue it.
  await vi.advanceTimersByTimeAsync(3_600_000 - 1);
  expect((await chats.get(chat.id)).messages).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  await waitForChatEvent(chat.id, ({ message }) => message.id === soon.id);
  await waitForSummary(chat.id, (summary) => !summary.nextSend);
  expect(
    (await chats.get(chat.id)).messages.map((message) => message.id),
  ).toEqual([soon.id]);
  expect((await chats.get(chat.id)).scheduled).toBeUndefined();
  expect(chats.list(projectId)[0].nextSend).toBeUndefined();

  // A lost acknowledgement can be retried after the original time passed.
  await expect(chats.send(chat.id, scheduled)).resolves.toBeUndefined();
  expect((await chats.get(chat.id)).messages.map((m) => m.id)).toEqual([
    soon.id,
  ]);

  await expect(
    chats.send(chat.id, { ...input("Too late"), sendAt: Date.now() - 1000 }),
  ).rejects.toThrow("future");
  const now = input("Send me early."),
    dropped = input("Never mind.");
  await chats.send(chat.id, { ...now, sendAt: Date.now() + 3_600_000 });
  // A retry without sendAt must leave a scheduled message waiting, not start it early.
  await chats.send(chat.id, now);
  expect((await chats.get(chat.id)).messages.some((m) => m.id === now.id)).toBe(
    false,
  );
  const shot = {
    name: "s.png",
    mimeType: "image/png" as const,
    dataUrl: "data:image/png;base64,AAAA",
  };
  await chats.send(chat.id, {
    ...dropped,
    images: [shot],
    sendAt: Date.now() + 3_600_000,
  });
  // A phone takes a waiting message's screenshots before it takes the message out.
  expect(await chats.queuedImages(chat.id, dropped.id)).toEqual([shot]);
  expect(await chats.queuedImages(chat.id, now.id)).toEqual([]);
  await chats.queueAction(chat.id, "steer", now.id);
  await chats.queueAction(chat.id, "remove", dropped.id);
  await expect(chats.queuedImages(chat.id, dropped.id)).rejects.toThrow(
    "no longer waiting",
  );
  saved = await chats.get(chat.id);
  expect(saved.messages.map((m) => m.id)).toEqual([soon.id, now.id]);
  expect(saved.scheduled).toBeUndefined();

  // Due while Relay was closed: it goes out once Relay arms it again.
  const missed = input("Sent after restart.");
  const missedAt = Date.now() + 3_600_000;
  await chats.send(chat.id, { ...missed, sendAt: missedAt });
  await chats.dispose();
  // Quit cleared the fake scheduler timers; startup uses real event-loop timers again.
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(missedAt + 1);
  restart(recordEvent);
  expect((await chats.get(chat.id)).scheduled).toHaveLength(1);
  chats.armWakeups();
  await waitForChatEvent(chat.id, ({ message }) => message.id === missed.id);
  await waitForSummary(chat.id, (summary) => !summary.nextSend);
  expect((await chats.get(chat.id)).messages.at(-1)?.id).toBe(missed.id);
});
it.each([false, true])(
  "holds a scheduled /btw message until its time, existing side conversation = %s",
  async (reply) => {
    const chat = await chats.create(projectId, { kind: "project" });
    await chats.send(chat.id, input("@codex Main question"));
    await waitForChatEvent(
      chat.id,
      ({ message }) =>
        message.status === "complete" && message.role === "assistant",
    );
    let parentId: string | undefined;
    if (reply) {
      const first = { ...input("@codex Side question"), side: true as const };
      await chats.send(chat.id, first);
      await waitForChatEvent(
        chat.id,
        ({ message }) =>
          message.parentId === first.id && message.status === "complete",
      );
      parentId = first.id;
    }
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const hour = 3_600_000;
    const later = {
      ...input("@codex Scheduled side question"),
      ...(parentId ? { parentId } : { side: true as const }),
      sendAt: Date.now() + hour,
    };
    await chats.send(chat.id, later);
    await chats.send(chat.id, later);
    const saved = await chats.get(chat.id);
    expect(saved.scheduled).toHaveLength(1);
    expect(saved.scheduled?.[0]).toMatchObject({
      input: { id: later.id },
      at: later.sendAt,
    });
    expect(saved.messages.some((m) => m.id === later.id)).toBe(false);
    expect(await agentCalls()).not.toContain("Scheduled side question");
    await vi.advanceTimersByTimeAsync(hour - 1);
    expect(
      (await chats.get(chat.id)).messages.some((m) => m.id === later.id),
    ).toBe(false);
    const before = events.length;
    await vi.advanceTimersByTimeAsync(1);
    await waitForChatEvent(
      chat.id,
      ({ message }) => message.id === later.id,
      before,
    );
    await waitForChatEvent(
      chat.id,
      ({ message }) =>
        message.parentId === (parentId ?? later.id) &&
        message.status === "complete" &&
        message.role === "assistant",
      before,
    );
    const sent = await chats.get(chat.id);
    expect(sent.scheduled).toBeUndefined();
    expect(sent.messages.find((m) => m.id === later.id)).toMatchObject(
      parentId ? { parentId } : { side: true },
    );
    expect(await agentCalls()).toContain("Scheduled side question");
  },
);

it("queues incompatible steering first without pausing or changing permissions", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  const followup = {
    ...input("@codex Change the cache"),
    runtimeMode: "auto-accept-edits" as const,
    delivery: "steer" as const,
  };
  await chats.send(chat.id, input("@codex Earlier"));
  await chats.send(chat.id, followup);
  const saved = await chats.get(chat.id);
  expect(saved.queuePaused).toBeFalsy();
  expect(saved.queue?.map((q) => q.input.id)[0]).toBe(followup.id);
  expect(saved.queue?.[0].error).toBeUndefined();
  expect(saved.messages.some((m) => m.id === followup.id)).toBe(false);
  expect(await agentCalls()).not.toContain('"steer"');
  await chats.queueAction(chat.id, "move", followup.id, 1);
  expect((await chats.get(chat.id)).queue?.map((q) => q.input.body)).toEqual([
    "@codex Earlier",
    "@codex Change the cache",
  ]);
  await chats.queueAction(chat.id, "remove", followup.id);
  expect((await chats.get(chat.id)).queue).toHaveLength(1);
});

it.each(["accept", "decline", "acceptForSession"] as const)(
  "waits for a local %s approval and never persists the request",
  async (decision) => {
    const chat = await chats.create(projectId, { kind: "project" });
    await chats.send(chat.id, input("@codex fixture request approval"));
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).requests).toHaveLength(1),
    );
    const request = (await chats.get(chat.id)).requests![0];
    expect(request).toMatchObject({
      kind: "approval",
      detail: expect.stringContaining("npm test"),
    });
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "streaming",
    );
    expect(await agentCalls()).not.toContain('"response"');
    expect(
      await readFile(join(root, "chats", chat.id + ".json"), "utf8"),
    ).not.toContain("Run this command?");
    expect(() =>
      chats.respond(chat.id, request.id, { kind: "question", answers: {} }),
    ).toThrow("Invalid response type");
    chats.respond(chat.id, request.id, { kind: "approval", decision });
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    );
    const calls = (await agentCalls())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.find((c) => c.response).response.result).toEqual({ decision });
    expect((await chats.get(chat.id)).requests).toEqual([]);
    expect(() =>
      chats.respond(chat.id, request.id, { kind: "approval", decision }),
    ).toThrow();
  },
);

it("stops while awaiting approval without leaving a request or replaying queued work", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture request approval"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).requests).toHaveLength(1),
  );
  await chats.send(chat.id, input("@codex keep this queued"));
  await chats.cancel(chat.id);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "cancelled",
    ),
  );
  const state = await chats.get(chat.id);
  expect(state.requests).toEqual([]);
  expect(state.queuePaused).toBe(true);
  expect(state.queue).toHaveLength(1);
  expect(state.messages.at(-1)?.error).toBeUndefined();
});

it("uses native Plan mode and answers harness questions without adding answers to chat", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@codex fixture ask question"),
    interactionMode: "plan",
    runtimeMode: "full-access",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).requests).toHaveLength(1),
  );
  const request = (await chats.get(chat.id)).requests![0];
  expect(request.kind).toBe("question");
  expect(() =>
    chats.respond(chat.id, request.id, { kind: "question", answers: {} }),
  ).toThrow("Answer each question");
  chats.respond(chat.id, request.id, {
    kind: "question",
    answers: { approach: ["Small change"] },
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(calls.find((c) => c.turn).turn).toMatchObject({
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
    collaborationMode: { mode: "plan" },
  });
  expect(calls.find((c) => c.response).response.result).toEqual({
    answers: { approach: { answers: ["Small change"] } },
  });
  const { messages } = await chats.get(chat.id);
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(messages.some((m) => m.body.includes("Small change"))).toBe(false);
  expect(messages[1].trace).toContainEqual(
    expect.objectContaining({
      activity: expect.objectContaining({
        questionAnswers: [
          {
            question: "Which approach should the plan use?",
            answer: "Small change",
          },
        ],
      }),
    }),
  );
});

it("replaces automatic review policy when returning to Full access in a saved thread", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  for (const runtimeMode of [
    "auto",
    "auto-accept-edits",
    "full-access",
  ] as const) {
    await chats.send(chat.id, {
      ...input("@codex Explain the cache"),
      runtimeMode,
    });
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    );
    await vi.waitFor(() =>
      expect(chats.hasActiveProject(projectId)).toBe(false),
    );
  }
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const turns = calls.filter((c) => c.turn).map((c) => c.turn);
  expect(
    turns.map((t) => [
      t.approvalPolicy,
      t.approvalsReviewer,
      t.sandboxPolicy.type,
    ]),
  ).toEqual([
    ["on-request", "auto_review", "workspaceWrite"],
    ["on-request", "user", "workspaceWrite"],
    ["never", "user", "dangerFullAccess"],
  ]);
  expect(calls.filter((c) => c.thread)).toHaveLength(1);
});

it("treats the approval menu's Cancel as a neutral stop", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture request approval"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).requests).toHaveLength(1),
  );
  const request = (await chats.get(chat.id)).requests![0];
  await chats.respond(chat.id, request.id, {
    kind: "approval",
    decision: "cancel",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "cancelled",
    ),
  );
  expect((await chats.get(chat.id)).messages.at(-1)?.error).toBeUndefined();
});

it.each(["accept", "decline", "acceptForSession"] as const)(
  "answers Claude SDK permission callbacks with %s",
  async (decision) => {
    const chat = await chats.create(projectId, { kind: "project" });
    await chats.send(chat.id, {
      ...input("@claude fixture request approval"),
      provider: "claude",
      runtimeMode: "auto-accept-edits",
    });
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).requests).toHaveLength(1),
    );
    const request = (await chats.get(chat.id)).requests![0];
    expect(request.title).toBe("Allow Bash?");
    chats.respond(chat.id, request.id, { kind: "approval", decision });
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    );
    const calls = (await agentCalls())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const call = calls.find((c) => c.claudeResponse);
    expect(call.args).toContain("acceptEdits");
    expect(call.claudeResponse.response.response.behavior).toBe(
      decision === "decline" ? "deny" : "allow",
    );
    if (decision === "acceptForSession")
      expect(call.claudeResponse.response.response.updatedPermissions).toEqual([
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "npm test" }],
          behavior: "allow",
          destination: "session",
        },
      ]);
  },
);

it("shows Claude planning questions and captures ExitPlanMode as a proposal without granting edits", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude fixture ask question"),
    provider: "claude",
    interactionMode: "plan",
    runtimeMode: "full-access",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).requests).toHaveLength(1),
  );
  chats.respond(chat.id, (await chats.get(chat.id)).requests![0].id, {
    kind: "question",
    answers: { "0": ["Small change"] },
  });
  // "complete" shows a moment before the turn gives the thread back.
  await vi.waitFor(async () => {
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete");
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
  await chats.send(chat.id, {
    ...input("@claude fixture propose plan"),
    provider: "claude",
    interactionMode: "plan",
    runtimeMode: "full-access",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const state = await chats.get(chat.id);
  expect(state.messages.at(-1)).toMatchObject({
    proposedPlan: true,
    body: expect.stringContaining("## Proposed plan"),
  });
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const responses = calls.filter((c) => c.claudeResponse);
  expect(responses[0].args).toContain("plan");
  expect(
    responses[0].claudeResponse.response.response.updatedInput.answers,
  ).toEqual({
    "Which approach should the plan use?": ["Small change"].join(", "),
  });
  expect(responses.at(-1).claudeResponse.response.response.behavior).toBe(
    "deny",
  );
});

it.each(["codex", "claude"] as const)(
  "keeps %s session approvals across turns but isolates a new thread",
  async (provider) => {
    const chat = await chats.create(projectId, { kind: "project" });
    const request = () => ({
      ...input(`@${provider} fixture request approval`),
      provider,
    });
    await chats.send(chat.id, request());
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).requests).toHaveLength(1),
    );
    chats.respond(chat.id, (await chats.get(chat.id)).requests![0].id, {
      kind: "approval",
      decision: "acceptForSession",
    });
    await vi.waitFor(async () =>
      expect(chats.hasActiveProject(projectId)).toBe(false),
    );
    await chats.send(chat.id, request());
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    );
    const calls = (await agentCalls())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const turns = calls.filter((c) =>
      provider === "codex"
        ? c.turn && !c.turn.input[0].text.startsWith("Generate a short title")
        : c.provider === "claude" &&
          c.args.includes("--permission-prompt-tool") &&
          c.prompt.includes("fixture request approval"),
    );
    expect(turns).toHaveLength(2);
    expect(turns[0].pid).toBe(turns[1].pid);
    expect(calls.filter((c) => c.response || c.claudeResponse)).toHaveLength(1);
    const other = await chats.create(projectId, { kind: "project" });
    await chats.send(other.id, request());
    await vi.waitFor(async () =>
      expect((await chats.get(other.id)).requests).toHaveLength(1),
    );
    await chats.cancel(other.id);
  },
);

it("resumes Claude's own saved session after restart without mixing Codex's cursor", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  // An answer reads complete before its turn lets go of the thread; asked
  // then, Claude would only queue, and the restart would drop it.
  const finished = (provider: "codex" | "claude") =>
    vi.waitFor(async () => {
      expect((await chats.get(chat.id)).messages.at(-1)).toMatchObject({
        provider,
        status: "complete",
      });
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  await chats.send(chat.id, input("@codex Explain cache guard"));
  await finished("codex");
  await chats.send(chat.id, {
    ...input("@claude Explain the cache guard"),
    provider: "claude",
  });
  await finished("claude");
  await chats.dispose();
  restart(() => {});
  const saved = await chats.get(chat.id);
  expect(saved.sessions?.codex?.thread).toBe("fixture-thread");
  expect(saved.sessions?.claude?.thread).toBe("fixture-claude");
  await chats.send(chat.id, {
    ...input("@claude Continue with the next step"),
    provider: "claude",
  });
  await finished("claude");
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const turns = calls.filter(
    (c) =>
      c.provider === "claude" && c.args.includes("--permission-prompt-tool"),
  );
  expect(turns.at(-1).args).toContain("--resume=fixture-claude");
  expect(turns.at(-1).args.join(" ")).not.toContain("fixture-thread");
  expect(turns.at(-1).prompt).not.toContain(
    "Claude found the same cache guard.",
  );
});
const captured = async () =>
  (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
it("answers /btw from Claude's session beside its running turn, and remembers the side thread", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(chat.id, claude("@claude fixture wait for steer"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).sessions?.claude?.thread).toBeTruthy(),
  );
  const question = {
    ...claude("@claude where is the cache guard?"),
    side: true as const,
  };
  await chats.send(chat.id, question);
  const answered = async () => {
    const saved = await chats.get(chat.id);
    const answers = saved.messages.filter(
      (m) => m.parentId === question.id && m.role === "assistant",
    );
    expect(answers.every((m) => m.status === "complete")).toBe(true);
    return { saved, answers };
  };
  const first = await vi.waitFor(answered);
  expect(first.answers.map((m) => m.body)).toEqual([
    "On the side: where is the cache guard?",
  ]);
  expect(first.saved.messages.find((m) => m.id === question.id)?.side).toBe(
    true,
  );
  // The main turn kept running, and nothing waited behind it.
  expect(first.saved.messages[1]!.status).toBe("streaming");
  expect(first.saved.queue ?? []).toEqual([]);
  // Claude's side question is text only: a screenshot fails loudly, not silently.
  await expect(
    chats.send(chat.id, {
      ...claude("@claude what's in this?"),
      parentId: question.id,
      images: [
        {
          name: "screen.png",
          mimeType: "image/png",
          dataUrl: `data:image/png;base64,${tinyPng}`,
        },
      ],
    }),
  ).rejects.toThrow("can't see screenshots in a side conversation");
  await chats.send(chat.id, {
    ...claude("@claude and why?"),
    parentId: question.id,
  });
  await vi.waitFor(async () =>
    expect((await answered()).answers).toHaveLength(2),
  );
  const asked = (await captured()).filter((c) => c.side);
  expect(asked.map((c) => c.side.question)).toEqual([
    "where is the cache guard?",
    "and why?",
  ]);
  expect(asked[1].side.history).toEqual([
    {
      question: "where is the cache guard?",
      response: "On the side: where is the cache guard?",
    },
  ]);
});
it("fails a /btw question outright when its folder is gone, instead of leaving an answer streaming", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(chat.id, claude("@claude fixture wait for steer"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).sessions?.claude?.thread).toBeTruthy(),
  );
  vi.spyOn(projects, "root").mockRejectedValue(new Error("Folder is gone."));
  const before = (await chats.get(chat.id)).messages.length;
  await expect(
    chats.send(chat.id, {
      ...claude("@claude where is the cache guard?"),
      side: true as const,
    }),
  ).rejects.toThrow("Folder is gone.");
  expect((await chats.get(chat.id)).messages).toHaveLength(before);
});
it("refuses a /btw for an agent that can't fork the thread before saving anything", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await expect(
    chats.send(chat.id, {
      ...input("@amp where is the cache guard?"),
      provider: "amp" as const,
      side: true as const,
    }),
  ).rejects.toThrow("Amp can't answer beside the thread.");
  expect((await chats.get(chat.id)).messages).toEqual([]);
});
it("asks /btw of a read-only Codex fork while its turn runs, and keeps it from the main session", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).sessions?.codex?.thread).toBeTruthy(),
  );
  const question = {
    ...input("@codex which test covers the guard?"),
    side: true as const,
    images: [
      {
        name: "screen.png",
        mimeType: "image/png" as const,
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  };
  await chats.send(chat.id, question);
  await vi.waitFor(async () =>
    expect(
      (await chats.get(chat.id)).messages.find(
        (m) => m.parentId === question.id,
      )?.status,
    ).toBe("complete"),
  );
  expect((await chats.get(chat.id)).messages[1]!.status).toBe("streaming");
  const fork = (await captured()).find((c) => c.method === "thread/fork");
  // The whole thread, its running turn included, in a sandbox that can't write.
  expect(fork.thread.lastTurnId).toBeUndefined();
  expect(fork.thread.sandbox).toBe("read-only");
  expect(fork.thread.developerInstructions).toContain(
    "You are in a side conversation",
  );
  const asked = (await captured()).find((c) =>
    c.turn?.input.some((i: { text?: string }) =>
      i.text?.includes("which test covers"),
    ),
  );
  expect(asked.turn.input).toContainEqual(
    expect.objectContaining({ type: "localImage" }),
  );
  await chats.cancel(chat.id);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages[1]!.status).toBe("cancelled"),
  );
  await chats.send(chat.id, input("@codex Now fix it"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const main = (await captured()).filter((c) =>
    c.turn?.input.some((i: { text?: string }) =>
      i.text?.includes("Now fix it"),
    ),
  );
  expect(main).toHaveLength(1);
  expect(JSON.stringify(main[0].turn.input)).not.toContain("which test covers");
});
it("keeps a handed-over thread's briefing for the retry when its first turn fails", async () => {
  const cli = await findExecutable("codex");
  vi.mocked(findExecutable).mockRejectedValue(
    new Error("Codex isn't installed"),
  );
  const { id } = await chats.adopt(
    projectId,
    {
      from: "Laptop",
      repositories: [],
      title: "Changelog",
      scope: { kind: "project" },
      settings: { ...input(""), body: undefined, id: undefined } as never,
      messages: [],
      git: {} as never,
    },
    { id: randomUUID(), computer: "Laptop", deviceId: "d", at: 1, tip: "x" },
    { path: projects.get(projectId)!.path, branch: "main" },
  );
  const settled = (status: string) =>
    vi.waitFor(async () => {
      expect((await chats.get(id)).messages.at(-1)?.status).toBe(status);
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  await settled("failed");
  vi.mocked(findExecutable).mockResolvedValue(cli);
  const prompts = async () =>
    (await agentCalls())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((c) => c.turn)
      .map((c) =>
        (c.turn.input as { text?: string }[]).map((i) => i.text).join("\n"),
      );
  await chats.send(id, input("@codex Try again"));
  await settled("complete");
  expect((await prompts()).at(-1)).toContain(
    "handed over from another computer",
  );
  // Told once it went through.
  await chats.send(id, input("@codex And then?"));
  await settled("complete");
  expect((await prompts()).at(-1)).not.toContain(
    "handed over from another computer",
  );
});
