import { describe, expect, it } from "vitest";
import { EditorHandoffs } from "./editor-handoffs";

const buffer = (path: string, text: string) => ({ path, text });
const target = (path: string) => ({ path, directory: false });

describe("EditorHandoffs", () => {
  it("hands what a side holds over once", () => {
    const held = new EditorHandoffs();
    held.add("editor", "w", { buffers: [buffer("a.ts", "one")] });
    expect(held.take("editor", "w").buffers).toEqual([buffer("a.ts", "one")]);
    expect(held.take("editor", "w")).toEqual({ buffers: [], opens: [] });
    expect(held.waiting()).toEqual([]);
  });

  it("keeps the two sides and the workspaces apart", () => {
    const held = new EditorHandoffs();
    held.add("editor", "w", { buffers: [buffer("a.ts", "to the editor")] });
    held.add("host", "w", { buffers: [buffer("a.ts", "back")] });
    held.add("editor", "v", { opens: [target("b.ts")] });
    expect(held.waiting().sort()).toEqual(["v", "w"]);
    expect(held.take("host", "w").buffers[0].text).toBe("back");
    expect(held.take("host", "v")).toEqual({ buffers: [], opens: [] });
    expect(held.take("editor", "w").buffers[0].text).toBe("to the editor");
    expect(held.take("editor", "v").opens).toEqual([target("b.ts")]);
  });

  it("lets a newer buffer for a file replace the older, and tells an outside file from a project's of the same path", () => {
    const held = new EditorHandoffs();
    held.add("editor", "w", {
      buffers: [
        buffer("a.ts", "old"),
        { ...buffer("a.ts", "outside"), outside: true },
      ],
    });
    held.add("editor", "w", { buffers: [buffer("a.ts", "new")] });
    expect(held.take("editor", "w").buffers).toEqual([
      buffer("a.ts", "new"),
      { ...buffer("a.ts", "outside"), outside: true },
    ]);
  });

  it("keeps only the newest files asked for", () => {
    const held = new EditorHandoffs();
    held.add("editor", "w", {
      opens: Array.from({ length: 30 }, (_, i) => target(`f${i}.ts`)),
    });
    const { opens } = held.take("editor", "w");
    expect(opens).toHaveLength(20);
    expect(opens.at(-1)?.path).toBe("f29.ts");
  });

  it("holds nothing for an empty handoff, and lets go when asked", () => {
    const held = new EditorHandoffs();
    held.add("editor", "w", { buffers: [] });
    expect(held.waiting()).toEqual([]);
    held.add("editor", "w", { buffers: [buffer("a.ts", "x")] });
    held.clear("editor", "w");
    expect(held.take("editor", "w").buffers).toEqual([]);
  });
});
