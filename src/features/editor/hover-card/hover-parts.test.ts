import { describe, expect, it } from "vitest";
import { hoverParts } from "./hover-parts";

describe("hoverParts", () => {
  it("takes a TypeScript method's class out of its signature", () => {
    const parts = hoverParts(
      "```typescript\n(method) HandoffFollowing.follow(computerId: string, chatId?: string): Promise<void>\n```\nAsks the computer to keep these threads up to date.\n\n*@param* `computerId` — which one",
    );
    expect(parts).toEqual({
      kind: "method",
      owner: "HandoffFollowing",
      signature: "follow(computerId: string, chatId?: string): Promise<void>",
      docs: "Asks the computer to keep these threads up to date.",
      tags: [{ label: "Params", entries: ["`computerId` — which one"] }],
    });
  });

  it("groups doc tags by kind, an example keeping its code", () => {
    const parts = hoverParts(
      "```ts\n(function) pick(a: number, b?: string | undefined): number\n```\nPicks one.\n\n*@param* `a` — first\n\n*@param* `b` — second\n\n*@returns* — the pick\n\n*@example*\n```ts\npick(1)\n```",
    );
    expect(parts.signature).toBe("function pick(a: number, b?: string): number");
    expect(parts.docs).toBe("Picks one.");
    expect(parts.tags).toEqual([
      { label: "Params", entries: ["`a` — first", "`b` — second"] },
      { label: "Returns", entries: ["the pick"] },
      { label: "Example", entries: ["```ts\npick(1)\n```"] },
    ]);
  });

  it("keeps one group for a tag that comes back after another", () => {
    const parts = hoverParts(
      "```ts\n(function) f(a: number, b: number): void\n```\n*@param* `a` — one\n\n*@throws* — never\n\n*@param* `b` — two",
    );
    expect(parts.tags.map((t) => t.label)).toEqual(["Params", "Throws"]);
    expect(parts.tags[0].entries).toEqual(["`a` — one", "`b` — two"]);
  });

  it("drops the import line TypeScript adds under an imported class", () => {
    const parts = hoverParts("```typescript\n(alias) new HandoffFollowing(): HandoffFollowing\nimport HandoffFollowing\n```");
    expect(parts.signature).toBe("new HandoffFollowing(): HandoffFollowing");
  });

  it("gives a TypeScript local back the keyword that declared it", () => {
    const parts = hoverParts("```typescript\n(local const) messages: string[]\n```");
    expect(parts.signature).toBe("const messages: string[]");
    expect(parts.owner).toBeUndefined();
  });

  it("reads intelephense's bold name and drops its PHP tags and empty body", () => {
    const parts = hoverParts(
      "__App\\Http\\UserController::show__\n\n```php\n<?php\npublic function show(int $id): array { }\n```\n\nLooks up a user.",
    );
    expect(parts.owner).toBe("UserController");
    expect(parts.signature).toBe("public function show(int $id): array");
    expect(parts.docs).toBe("Looks up a user.");
  });

  it("reads clangd's heading and the class it names in a comment", () => {
    const parts = hoverParts(
      "### method `follow`  \n\n---\n→ `void`  \nKeeps them in step.\n\n---\n```cpp\n// In Following\npublic: void follow(const char *id)\n```",
    );
    expect(parts.kind).toBe("method");
    expect(parts.owner).toBe("Following");
    expect(parts.signature).toBe("void follow(const char *id)");
    expect(parts.docs).toBe("→ `void`  \nKeeps them in step.");
  });

  it("takes rust-analyzer's module path as the owner", () => {
    const parts = hoverParts("```rust\nrelay::handoff\n```\n\n```rust\npub fn follow(id: &str)\n```\n\n---\n\nKeeps them in step.");
    expect(parts.owner).toBe("relay::handoff");
    expect(parts.signature).toBe("pub fn follow(id: &str)");
    expect(parts.docs).toBe("Keeps them in step.");
  });

  it("keeps docs without a code block as they are", () => {
    expect(hoverParts("Just *words*.")).toEqual({ docs: "Just *words*.", tags: [] });
  });
});
