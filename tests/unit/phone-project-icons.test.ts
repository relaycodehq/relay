import { expect, it } from "vitest";
import {
  applyIconUpdates,
  projectIcon,
  knownHashes,
  type IconIndex,
} from "../../mobile/src/remote/project-icon-index";

const save = (id: string, icon: { hash: string }) => `file:///${id}-${icon.hash}.png`;
const icon = (hash: string) => ({ hash, dataUrl: "data:image/png;base64,AA==" });

it("leaves the other computer's icons alone when one computer syncs", () => {
  const index: IconIndex = {
    mac: { relay: { hash: "a", uri: "file:///relay-a.png" } },
    linux: {
      server: { hash: "b", uri: "file:///server-b.png" },
      gone: { hash: "c", uri: "file:///gone-c.png" },
    },
  };
  expect(knownHashes(index, "linux", ["server", "fresh"])).toEqual({ server: "b" });

  const next = applyIconUpdates(
    index,
    "linux",
    ["server", "fresh"],
    { server: icon("b2"), fresh: { hash: null } },
    save,
  );
  expect(next.index).toEqual({
    mac: { relay: { hash: "a", uri: "file:///relay-a.png" } },
    linux: {
      server: { hash: "b2", uri: "file:///server-b2.png" },
      fresh: { hash: null },
    },
  });
  // The replaced icon and the removed project's; never the Mac's.
  expect(next.unused.sort()).toEqual(["file:///gone-c.png", "file:///server-b.png"]);
  expect(projectIcon(next.index, "mac", "relay")).toBe("file:///relay-a.png");
});

it("shows the active computer's icon even when their project ids match", () => {
  const index: IconIndex = {
    mac: { relay: { hash: "a", uri: "file:///mac.png" } },
    linux: { relay: { hash: "b", uri: "file:///linux.png" } },
  };
  expect(projectIcon(index, "mac", "relay")).toBe("file:///mac.png");
  expect(projectIcon(index, "linux", "relay")).toBe("file:///linux.png");
  expect(projectIcon(index, undefined, "relay")).toBeUndefined();
});

it("keeps a file the update wrote to the same place", () => {
  const index: IconIndex = { mac: { relay: { hash: "a", uri: "file:///relay-a.png" } } };
  const next = applyIconUpdates(index, "mac", ["relay"], { relay: icon("a") }, save);
  expect(next.unused).toEqual([]);
});
