import { describe, expect, it } from "vitest";
import {
  availableWhere,
  projectsByUse,
  startingWhere,
} from "../../mobile/src/remote/new-thread";
import type { RemoteProject } from "../../shared/remote";

const relay: RemoteProject = { id: "relay", name: "Relay" };
const site: RemoteProject = { id: "site", name: "Site" };
const notes: RemoteProject = { id: "notes", name: "Notes" };
const pad: RemoteProject = { id: "pad-1", name: "Scratchpad", scratch: true };
const projects = [relay, site, notes, pad];

describe("startingWhere", () => {
  it("starts where the latest thread is", () => {
    expect(
      startingWhere({ projects, chats: [{ projectId: "site" }] }, {}),
    ).toBe("site");
  });

  it("starts a Scratchpad chat after a Scratchpad thread, not in its used folder", () => {
    const overview = { projects, chats: [{ projectId: "pad-1" }] };
    expect(startingWhere(overview, {})).toBe("scratch");
    expect(startingWhere(overview, { project: "pad-1" })).toBe("scratch");
  });

  it("prefers the project it was opened for", () => {
    expect(
      startingWhere(
        { projects, chats: [{ projectId: "site" }] },
        { project: "notes" },
      ),
    ).toBe("notes");
  });

  it("waits for the project list unless asked for the Scratchpad", () => {
    expect(startingWhere(undefined, { project: "relay" })).toBeUndefined();
    expect(startingWhere(undefined, { scratch: "1" })).toBe("scratch");
  });

  it("falls back to the first project, then the Scratchpad", () => {
    expect(startingWhere({ projects, chats: [] }, {})).toBe("relay");
    expect(startingWhere({ projects: [pad], chats: [] }, {})).toBe("scratch");
  });
});

describe("projectsByUse", () => {
  it("puts recently used projects first and keeps the rest in order", () => {
    const chats = [
      { projectId: "notes" },
      { projectId: "pad-1" },
      { projectId: "notes" },
      { projectId: "site" },
    ];
    expect(
      projectsByUse([...projects, { id: "x", name: "X" }], chats).map(
        (p) => p.id,
      ),
    ).toEqual(["notes", "site", "relay", "x"]);
  });
});

describe("availableWhere", () => {
  it("holds a valid choice when another project becomes the latest", () => {
    expect(availableWhere("relay", { projects, chats: [{ projectId: "site" }] }, {})).toBe("relay");
  });

  it("replaces a project removed from the live list, including a stale route parameter", () => {
    const overview = { projects: [site, notes], chats: [{ projectId: "relay" }] };
    expect(availableWhere("relay", overview, { project: "relay" })).toBe("site");
    expect(startingWhere(overview, {})).toBe("site");
  });

  it("uses Scratchpad when the last real project is removed", () => {
    expect(availableWhere("relay", { projects: [pad], chats: [] }, {})).toBe("scratch");
  });

  it("keeps a choice until a project list can confirm it was removed", () => {
    expect(availableWhere("relay", undefined, {})).toBe("relay");
    expect(availableWhere(undefined, undefined, {})).toBeUndefined();
    expect(availableWhere("scratch", { projects: [], chats: [] }, {})).toBe("scratch");
  });
});
