import { expect, test } from "vitest";
import { ghostId, placementsOf, withGhosts } from "./import-offer";

const p = (id: string, folder?: string) => ({
  id,
  ...(folder ? { folder } : {}),
});
const ids = (list: { id: string }[]) => list.map((x) => x.id);

test("stand-ins go where the sidebar last showed them, real projects as they are now", () => {
  const real = [p("backend", "Work"), p("relay")];
  const web = p(ghostId("web"), "Work");
  const game = p(ghostId("game"), "Personal");
  // The user dragged Website above Backend and the game to the end.
  const order = [web, p("backend", "Work"), p("relay"), game];
  expect(ids(withGhosts(real, [web, game], order))).toEqual([
    web.id,
    "backend",
    "relay",
    game.id,
  ]);
  // One ticked again after the move isn't in the order: it ends its group.
  const design = p(ghostId("design"), "Work");
  expect(ids(withGhosts(real, [web, design, game], order))).toEqual([
    web.id,
    "backend",
    design.id,
    "relay",
    game.id,
  ]);
  // A real project removed since doesn't leave a stand-in stranded.
  expect(ids(withGhosts([p("relay")], [web], order))).toEqual([
    "relay",
    web.id,
  ]);
});

test("each stand-in lands above whatever sits right below it in its group", () => {
  const list = [
    p(ghostId("web"), "Work"),
    p("backend", "Work"),
    p(ghostId("design"), "Work"),
    p("relay"),
    p(ghostId("game"), "Personal"),
  ];
  expect(placementsOf(list)).toEqual([
    { key: "web", group: "Work", before: "backend" },
    { key: "design", group: "Work", before: null },
    { key: "game", group: "Personal", before: null },
  ]);
});
