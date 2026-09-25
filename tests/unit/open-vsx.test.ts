import { afterEach, expect, it, vi } from "vitest";
import { deflateRawSync } from "node:zlib";
import { fetchThemes, searchThemes } from "../../shared/open-vsx";

const CDN = "https://openvsx.eclipsecontent.org/acme/nightfall/1.0.0/pkg.vsix";
const ref = { namespace: "acme", name: "nightfall", version: "1.0.0" };

/** A zip whose entries are deflated, with room for a long local extra field. */
function zip(files: Record<string, string | Buffer>, localExtra = 0) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const extra = Buffer.alloc(name.endsWith(".json") ? localExtra : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, extra, data);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + extra.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Serves `body` the way Open VSX does: a redirect to a CDN that takes ranges. */
function serve(body: Buffer, { ranges = true } = {}) {
  const served: number[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const reply = (status: number, bytes: Buffer, headers = {}) => {
      served.push(bytes.length);
      const response = new Response(
        init?.method === "HEAD" ? null : new Uint8Array(bytes),
        { status, headers },
      );
      Object.defineProperty(response, "url", { value: CDN });
      return response;
    };
    if (init?.method === "HEAD")
      return reply(200, Buffer.alloc(0), {
        "content-length": String(body.length),
      });
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    const [, from, to] = range?.match(/bytes=(\d+)-(\d+)/) ?? [];
    if (!ranges || !range) return reply(200, body);
    return reply(206, body.subarray(Number(from), Number(to) + 1));
  });
  return served;
}

const manifest = (themes: object[]) =>
  JSON.stringify({ contributes: { themes } });

afterEach(() => vi.unstubAllGlobals());

it("reads only the themes out of a large package, includes and all", async () => {
  const served = serve(
    zip(
      {
        "extension/node_modules/huge.js": Buffer.alloc(3 << 20, "x"),
        "extension/package.json": manifest([
          { label: "%dark%", uiTheme: "vs-dark", path: "./themes/dark.json" },
        ]),
        "extension/package.nls.json": JSON.stringify({ dark: "Nightfall" }),
        "extension/themes/dark.json": `{
          // Comments and trailing commas are fine in theme files.
          "include": "./base.json",
          "colors": { "editor.background": "#101010", "bogus": "red;x" },
          "tokenColors": [{ "scope": "string", "settings": { "foreground": "#a0e0a0" } }],
        }`,
        "extension/themes/base.json": JSON.stringify({
          colors: {
            "editor.background": "#000000",
            "button.background": "#5588ff",
          },
          tokenColors: [
            {
              scope: "comment",
              settings: { foreground: "#777777", fontStyle: "italic" },
            },
            { scope: "keyword", settings: { foreground: "url(x)" } },
          ],
        }),
      },
      2000,
    ),
  );
  const [theme] = await fetchThemes(ref);
  expect(theme.label).toBe("Nightfall");
  expect(theme.colors).toEqual({
    "editor.background": "#101010",
    "button.background": "#5588ff",
  });
  expect(theme.tokenColors).toEqual([
    {
      scope: "comment",
      settings: { foreground: "#777777", fontStyle: "italic" },
    },
    { scope: "string", settings: { foreground: "#a0e0a0" } },
  ]);
  expect(served.reduce((sum, n) => sum + n, 0)).toBeLessThan(80_000);
});

it("refuses theme paths that leave the extension", async () => {
  serve(
    zip({
      "extension/package.json": manifest([
        { label: "Evil", uiTheme: "vs-dark", path: "../../etc/theme.json" },
      ]),
    }),
  );
  await expect(fetchThemes(ref)).rejects.toThrow("leaves the extension");
});

it("stops rather than download a whole package when ranges are ignored", async () => {
  serve(zip({ "extension/package.json": manifest([]) }), { ranges: false });
  await expect(fetchThemes(ref)).rejects.toThrow("partial download");
});

it("pages through themes only, without skipping or repeating any", async () => {
  // Every third hit is language support that bundles a theme; every fifth
  // contributes no theme at all.
  const all = Array.from({ length: 23 }, (_, i) => ({
    namespace: "pub",
    name: `ext${i}`,
    version: "1.0.0",
    kind: i % 3 === 2 ? "tool" : i % 5 === 4 ? "none" : "theme",
  }));
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    const reply = (body: unknown) => {
      const response = new Response(JSON.stringify(body));
      Object.defineProperty(response, "url", { value: input });
      return response;
    };
    if (url.pathname.endsWith("/-/search")) {
      const offset = Number(url.searchParams.get("offset"));
      const size = Number(url.searchParams.get("size"));
      return reply({ extensions: all.slice(offset, offset + size) });
    }
    const hit = all.find((e) => url.pathname.includes(`/pub/${e.name}/`))!;
    return reply({
      contributes: {
        ...(hit.kind !== "none" && {
          themes: [{ label: hit.name, uiTheme: "vs-dark", path: "./t.json" }],
        }),
        ...(hit.kind === "tool" && { languages: [{ id: "x" }] }),
      },
    });
  });
  const seen: string[] = [];
  const sizes: number[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await searchThemes("", offset);
    sizes.push(page.extensions.length);
    seen.push(...page.extensions.map((e) => e.name));
    offset = page.next;
  }
  expect(seen).toEqual(
    all.filter((e) => e.kind === "theme").map((e) => e.name),
  );
  expect(sizes.slice(0, -1).every((n) => n === 5)).toBe(true);
});

it("fails a page when Open VSX is busy instead of dropping themes from it", async () => {
  vi.stubGlobal("fetch", async (input: string) => {
    const busy = input.includes("/file/package.json") && input.includes("ext1");
    const body = input.includes("/-/search")
      ? {
          extensions: [0, 1, 2].map((i) => ({
            namespace: "pub",
            name: `ext${i}`,
            version: "1.0.0",
          })),
        }
      : {
          contributes: {
            themes: [{ label: "T", uiTheme: "vs", path: "./t.json" }],
          },
        };
    const response = new Response(JSON.stringify(body), {
      status: busy ? 503 : 200,
    });
    Object.defineProperty(response, "url", { value: input });
    return response;
  });
  await expect(searchThemes("")).rejects.toThrow("busy");
});
