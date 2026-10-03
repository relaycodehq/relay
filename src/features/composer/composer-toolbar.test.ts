import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultToolbar,
  hideItem,
  parseToolbar,
  placeSlot,
  toolbarRun,
} from "./composer-toolbar";

const dividersBefore = (run: ReturnType<typeof toolbarRun>) =>
  run.filter((s) => s.divider).map((s) => s.slot);

describe("toolbarRun", () => {
  it("puts dividers where the composer always had them", () => {
    expect(dividersBefore(toolbarRun(defaultToolbar, () => true))).toEqual([
      "effort",
      "context",
      "access",
      "mode",
    ]);
  });

  it("closes up around controls the composer doesn't offer", () => {
    // No effort for the model, no meter yet: model and access become neighbours.
    const run = toolbarRun(
      defaultToolbar,
      (item) => item !== "effort" && item !== "context",
    );
    expect(run.map((s) => s.slot).slice(0, 3)).toEqual([
      "model",
      "access",
      "mode",
    ]);
    expect(dividersBefore(run)).toEqual(["access", "mode"]);
  });

  it("never divides across the gap", () => {
    const layout = placeSlot(defaultToolbar, "usage", "mode", true);
    const moved = placeSlot(layout, "gap", "usage", false);
    const run = toolbarRun(moved, () => true);
    expect(run.find((s) => s.slot === "usage")?.divider).toBe(false);
  });
});

describe("parseToolbar", () => {
  it("drops junk and puts back controls a saved layout lacks", () => {
    const layout = parseToolbar({
      slots: ["mic", "model", "bogus", "model", "gap", "usage"],
      hidden: ["attach", "model", "gap", 3],
    });
    expect(layout.slots).toHaveLength(defaultToolbar.slots.length);
    expect(new Set(layout.slots)).toEqual(new Set(defaultToolbar.slots));
    // The saved order holds; new ones join beside their default neighbour.
    expect(layout.slots.slice(0, 4)).toEqual([
      "mic",
      "model",
      "account",
      "effort",
    ]);
    // The model can't be hidden, and the gap isn't a control. The account
    // control is new to this layout, and starts hidden as the default has it.
    expect(layout.hidden).toEqual(["attach", "account"]);
  });

  it("keeps a control shown that a saved layout already shows", () => {
    const layout = parseToolbar({ slots: defaultToolbar.slots, hidden: [] });
    expect(layout.hidden).toEqual([]);
  });

  it("reads garbage as the default", () => {
    expect(parseToolbar("nope")).toEqual(defaultToolbar);
  });
});

it("placing a hidden control shows it", () => {
  const hidden = hideItem(defaultToolbar, "usage");
  const placed = placeSlot(hidden, "usage", "model", true);
  expect(placed.hidden).toEqual(["account"]);
  expect(placed.slots.slice(0, 2)).toEqual(["model", "usage"]);
});

it("a move that changes nothing is the same layout", () => {
  // Dragover fires every few milliseconds; Settings renders only on a change.
  expect(placeSlot(defaultToolbar, "effort", "context", false)).toBe(
    defaultToolbar,
  );
  expect(placeSlot(defaultToolbar, "context", "effort", true)).toBe(
    defaultToolbar,
  );
});

describe("the old usage ring switch", () => {
  afterEach(() => vi.unstubAllGlobals());
  const load = async (saved: Record<string, string>) => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => saved[k] ?? null,
      setItem: () => {},
      removeItem: () => {},
    });
    return (await import("./composer-toolbar")).composerToolbar;
  };

  it("keeps the ring hidden for someone who had turned it off", async () => {
    const { hidden } = (await load({ "relay-usage-ring": "off" }))();
    expect(hidden).toEqual(["account", "usage"]);
  });

  it("no longer applies once a layout is saved", async () => {
    const layout = JSON.stringify(defaultToolbar);
    const read = await load({
      "relay-usage-ring": "off",
      "relay-composer-toolbar": layout,
    });
    expect(read().hidden).toEqual(["account"]);
  });
});
