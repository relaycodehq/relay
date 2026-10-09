import { expect, it } from "vitest";
import {
  applyIconUpdates,
  iconsByProject,
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
  expect(iconsByProject(next.index).relay?.uri).toBe("file:///relay-a.png");
});

it("keeps a file the update wrote to the same place", () => {
  const index: IconIndex = { mac: { relay: { hash: "a", uri: "file:///relay-a.png" } } };
  const next = applyIconUpdates(index, "mac", ["relay"], { relay: icon("a") }, save);
  expect(next.unused).toEqual([]);
});
