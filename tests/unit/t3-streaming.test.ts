import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { createIncrementalMarkdownPlugin } from "../../src/vendor/t3code/markdown-incremental";
import { withCodexTransport } from "../../electron/agents/codex/codex-transport";

function wire() {
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  const received: any[] = [];
  let rest = "";
  stdin.on("data", (chunk) => {
    rest += chunk.toString();
    let end;
    while ((end = rest.indexOf("\n")) >= 0) {
      received.push(JSON.parse(rest.slice(0, end)));
      rest = rest.slice(end + 1);
    }
  });
  return {
    child: {
      stdin,
      stdout,
      stderr,
    } as unknown as ChildProcessWithoutNullStreams,
    received,
    send: (value: unknown) => stdout.write(JSON.stringify(value) + "\n"),
  };
}
function render(source: string, plugin?: Plugin<[], Root>, parses?: string[]) {
  let tree: Root | undefined;
  const observe: Plugin<[], Root> = function () {
    const original = this.parser!;
    this.parser = (s, f) => {
      parses?.push(s);
      return original(s, f);
    };
  };
  const capture: Plugin<[], Root> = () => (root) => {
    tree = structuredClone(root);
  };
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [observe, capture, ...(plugin ? [plugin] : [])],
      children: source,
    }),
  );
  return { html, tree };
}
describe("pinned T3 source and Markdown streaming", () => {
  it("keeps every vendored file pristine and pins its runtime dependency", () => {
    const lock = JSON.parse(readFileSync("t3-streaming.lock.json", "utf8"));
    expect(lock.commit).toMatch(/^[a-f0-9]{40}$/);
    for (const file of lock.files)
      expect(
        createHash("sha256").update(readFileSync(file.local)).digest("hex"),
        file.local,
      ).toBe(file.sha256);
    expect(
      JSON.parse(readFileSync("package.json", "utf8")).dependencies.effect,
    ).toBe(lock.effect);
  });
  it("matches ordinary rendering at every streamed character, including late definitions and broken fences", () => {
    const prefix = "# Answer\n\n```ts\nconst x = 1;\n```\n\n";
    for (const suffix of [
      "**bold** and [later]\n\n[later]: /target",
      "- first\n\n  next\n\n```ts\nunclosed",
      "paragraph\r\nnext",
      "\uFEFFtail",
    ]) {
      const plugin = createIncrementalMarkdownPlugin(),
        source = prefix + suffix;
      for (let end = 0; end <= source.length; end++)
        expect(render(source.slice(0, end), plugin), `offset ${end}`).toEqual(
          render(source.slice(0, end)),
        );
    }
  });
  it("reuses a closed code prefix, but permits rewrites without leaking transformed nodes", () => {
    const prefix = "```ts\nconst x = 1;\n```\n\n",
      plugin = createIncrementalMarkdownPlugin(),
      parses: string[] = [];
    render(prefix + "Hello", plugin, parses);
    parses.length = 0;
    expect(render(prefix + "Hello again", plugin, parses)).toEqual(
      render(prefix + "Hello again"),
    );
    expect(parses).toEqual(["Hello again"]);
    for (const source of [
      prefix.replace("1", "2") + "Edit",
      "Replacement",
      prefix + "Hello again",
    ])
      expect(render(source, plugin)).toEqual(render(source));
  });
});
describe("T3 protocol through the desktop adapter", () => {
  it("preserves the original failure instead of replacing it with Effect.tryPromise", async () => {
    const w = wire();
    await expect(
      withCodexTransport(
        w.child,
        () => {},
        () => {},
        async () => {
          throw new Error("The provider rejected this model.");
        },
      ),
    ).rejects.toThrow("The provider rejected this model.");
  });
  it("correlates out-of-order requests and preserves fragmented Unicode notifications", async () => {
    const w = wire(),
      notifications: string[] = [],
      errors: Error[] = [];
    await withCodexTransport(
      w.child,
      (_, p) => notifications.push(p.delta),
      (e) => errors.push(e),
      async (transport) => {
        const a = transport.request("first", {}),
          b = transport.request("second", {});
        await vi.waitFor(() => expect(w.received).toHaveLength(2));
        w.send({ id: w.received[1].id, result: "second result" });
        w.send({ id: w.received[0].id, result: "first result" });
        const bytes = Buffer.from(
          JSON.stringify({
            method: "delta",
            params: { delta: "Žluťoučký 😅" },
          }) + "\n",
        );
        for (const byte of bytes) w.child.stdout.push(Buffer.from([byte]));
        expect(await a).toBe("first result");
        expect(await b).toBe("second result");
        await vi.waitFor(() => expect(notifications).toEqual(["Žluťoučký 😅"]));
      },
    );
    expect(errors).toEqual([]);
  });
  it("declines provider approval requests and rejects unknown tools", async () => {
    const w = wire();
    await withCodexTransport(
      w.child,
      () => {},
      () => {},
      async () => {
        w.send({
          id: "approval",
          method: "item/commandExecution/requestApproval",
          params: {},
        });
        w.send({ id: "unknown", method: "item/tool/call", params: {} });
        await vi.waitFor(() => expect(w.received).toHaveLength(2));
        expect(w.received.find((v) => v.id === "approval").result).toEqual({
          decision: "decline",
        });
        expect(w.received.find((v) => v.id === "unknown").error.code).toBe(
          -32601,
        );
      },
    );
  });
  it.each(["invalid JSON", "ended stream", "oversized frame"])(
    "fails pending requests on %s",
    async (failure) => {
      const w = wire(),
        errors: Error[] = [];
      await withCodexTransport(
        w.child,
        () => {},
        (e) => errors.push(e),
        async (transport) => {
          const pending = transport.request("pending", {});
          const assertion = expect(pending).rejects.toThrow();
          await vi.waitFor(() => expect(w.received).toHaveLength(1));
          if (failure === "invalid JSON") w.child.stdout.push("{broken}\n");
          else if (failure === "ended stream") w.child.stdout.push(null);
          else w.child.stdout.push(Buffer.alloc(4 * 1024 * 1024 + 1, 65));
          await assertion;
          expect(errors).toHaveLength(1);
        },
      );
    },
  );
});
