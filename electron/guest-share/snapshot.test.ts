import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import { guestSnapshot, withoutHostPaths } from "./snapshot";

describe("withoutHostPaths", () => {
  it("shows paths in the thread's folder relative to it, and the home folder as ~", () => {
    const root = join(homedir(), "code", "app");
    expect(withoutHostPaths(`read ${join(root, "src/a.ts")}`, root)).toBe(
      "read src/a.ts",
    );
    expect(withoutHostPaths(`cat ${join(homedir(), ".zshrc")}`, root)).toBe(
      "cat ~/.zshrc",
    );
  });

  it("leaves a folder that only starts like the home folder alone", () => {
    const sibling = `${homedir()}ex/notes.md`;
    expect(withoutHostPaths(sibling, null)).toBe(sibling);
  });
});

describe("guestSnapshot", () => {
  it("shows a picture whose path has spaces, as the app does", async () => {
    const root = join(homedir(), "code", "app");
    const answer = {
      id: "m1",
      seq: 1,
      role: "assistant",
      body: "Here: ![shot](/tmp/my shot.png)",
      status: "complete",
      created: 1,
      provider: "claude",
      version: 1,
    } as ChatMessage;
    const thread = { id: "t1", title: "Shots", messages: [answer] };
    const fail = async () => {
      throw new Error("Not read here.");
    };
    const snapshot = await guestSnapshot(
      thread as ProjectChat,
      root,
      { image: fail, readImage: fail, previewShot: fail, turnVideoPath: fail },
      Date.now() + 1000,
      (id) => id,
    );
    expect(snapshot.view.messages[0]!.html).toContain("data-media=");
    expect(snapshot.contents.images).toBe(1);
  });

  it("leaves the agent a message mentions out, as the app does", async () => {
    const sent = {
      id: "m1",
      seq: 1,
      role: "user",
      body: "@claude What does that mean",
      status: "complete",
      created: 1,
      provider: "claude",
      version: 1,
    } as ChatMessage;
    const fail = async () => {
      throw new Error("Not read here.");
    };
    const snapshot = await guestSnapshot(
      { id: "t2", title: "Mention", messages: [sent] } as ProjectChat,
      null,
      { image: fail, readImage: fail, previewShot: fail, turnVideoPath: fail },
      Date.now() + 1000,
      (id) => id,
    );
    expect(snapshot.view.messages[0]!.html).toBe("<p>What does that mean</p>");
  });
});
