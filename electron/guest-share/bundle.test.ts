import { expect, it } from "vitest";
import {
  BUNDLE_AUTHOR_CHARS,
  BUNDLE_TITLE_CHARS,
  guestBundleSchema,
} from "../../shared/guest-share";
import type { ChatMessage } from "../../shared/projects";
import { guestBundle } from "./bundle";
import type { GuestSnapshot } from "./snapshot";

it("cuts a long title and author to what an import takes", async () => {
  const message: ChatMessage = {
    id: "m1",
    role: "user",
    author: `Claude in ${"a very long thread title ".repeat(10)}`,
    body: "Hi",
    status: "complete",
    created: 1,
    provider: "claude",
    version: 1,
  };
  const snapshot = {
    view: { title: "t".repeat(400) },
    files: new Map(),
    conversation: [message],
    root: null,
  } as unknown as GuestSnapshot;
  const bundle = await guestBundle(snapshot);
  expect(bundle.title).toHaveLength(BUNDLE_TITLE_CHARS);
  expect(bundle.messages[0]!.from).toHaveLength(BUNDLE_AUTHOR_CHARS);
  expect(guestBundleSchema.safeParse(bundle).success).toBe(true);
});
