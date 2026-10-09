import { describe, expect, it, vi } from "vitest";
import { composeAttempt, sameDraft } from "../../mobile/src/remote/compose-attempt";
import { newThreadSettings } from "../../shared/remote-compose";

const settings = newThreadSettings(undefined);
const draft = { target: "project:checkout", body: "request", settings, images: [{ uri: "image" }] };

describe("phone send retries", () => {
  it("keeps the original schedule and message id when send retries an unchanged failed draft", () => {
    const ids = vi.fn().mockReturnValueOnce("one").mockReturnValueOnce("two");
    const first = composeAttempt(draft, { sendAt: 50000 }, undefined, ids);
    const retry = composeAttempt(draft, {}, first, ids);
    expect(retry).toBe(first);
    expect(retry.sendAt).toBe(50000);
    expect(retry.id).toBe("one");
    expect(ids).toHaveBeenCalledTimes(1);
  });

  it("keeps queue or steer delivery after a failed send", () => {
    const first = composeAttempt(draft, { delivery: "steer" }, undefined, () => "one");
    expect(composeAttempt(draft, { delivery: "queue" }, first, () => "two")).toBe(first);
  });

  it.each([
    { ...draft, target: "project:worktree" },
    { ...draft, body: "edited" },
    { ...draft, settings: { ...settings, interactionMode: "plan" as const } },
    { ...draft, images: [] },
  ])("makes a new attempt when the message, settings or attachments change", (edited) => {
    const first = composeAttempt(draft, { sendAt: 50000 }, undefined, () => "one");
    expect(composeAttempt(edited, {}, first, () => "two")).toEqual({ ...edited, id: "two" });
    expect(sameDraft(first, edited)).toBe(false);
  });

  it("allows an explicit new schedule instead of retrying", () => {
    const first = composeAttempt(draft, { sendAt: 50000 }, undefined, () => "one");
    const changed = composeAttempt(draft, { sendAt: 90000 }, undefined, () => "two");
    expect(changed.id).not.toBe(first.id);
    expect(changed.sendAt).toBe(90000);
  });
});
