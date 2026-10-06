import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureFileIconSprite, fileIcon, parentSuffixes } from "./file-icons";

const builtIn = (token: string) => `file-tree-builtin-${token}`;

const required: Record<string, string> = {
  "package.json": builtIn("npm"),
  "apps/web/package.json": builtIn("npm"),
  "PACKAGE.JSON": builtIn("npm"),
  "package-lock.json": builtIn("npm"),
  "tsconfig.json": builtIn("typescript"),
  "tsconfig.node.json": builtIn("typescript"),
  "jsconfig.json": builtIn("typescript"),
  "AGENTS.md": "relay-file-icon-agents",
  "docs/agents.md": "relay-file-icon-agents",
  "pnpm-lock.yaml": "relay-file-icon-pnpm",
  "pnpm-workspace.yaml": "relay-file-icon-pnpm",
  "CLAUDE.md": builtIn("claude"),
  "README.md": builtIn("markdown"),
  "docs/page.mdx": builtIn("markdown"),
  "bun.lock": builtIn("bun"),
  "bun.lockb": builtIn("bun"),
  Dockerfile: builtIn("docker"),
  "Dockerfile.dev": builtIn("docker"),
  "app.dockerfile": builtIn("docker"),
  "docker-compose.yml": builtIn("docker"),
  "docker-compose.prod.yaml": builtIn("docker"),
  ".dockerignore": builtIn("docker"),
  "docker-compose.test.ts": builtIn("typescript"),
  "dockerfile_parser.rs": builtIn("rust"),
  "DockerfileParser.java": builtIn("default"),
  "tsconfig.test.ts": builtIn("typescript"),
  "my-tsconfig.json": builtIn("json"),
  ".mcp.json": builtIn("mcp"),
  ".env": builtIn("text"),
  ".env.local": builtIn("text"),
  ".env.example": builtIn("text"),
  ".gitignore": builtIn("git"),
  ".gitattributes": builtIn("git"),
  ".gitmodules": builtIn("git"),
  "a.svg": builtIn("svg"),
  "a.ts": builtIn("typescript"),
  "a.mts": builtIn("typescript"),
  "a.cts": builtIn("typescript"),
  "types/a.d.ts": builtIn("typescript"),
  "a.tsx": builtIn("react"),
  "a.jsx": builtIn("react"),
  "a.js": builtIn("javascript"),
  "a.mjs": builtIn("javascript"),
  "a.cjs": builtIn("javascript"),
  "a.json": builtIn("json"),
  "a.jsonc": builtIn("json"),
  "a.json5": builtIn("json"),
  "a.css": builtIn("css"),
  "a.scss": builtIn("sass"),
  "a.sass": builtIn("sass"),
  "a.html": builtIn("html"),
  "a.sh": builtIn("bash"),
  "a.zsh": builtIn("bash"),
  "a.bash": builtIn("bash"),
  "a.yml": builtIn("yml"),
  "a.yaml": builtIn("yml"),
  "a.csv": builtIn("table"),
  "a.tsv": builtIn("table"),
  "a.sql": builtIn("database"),
  "a.db": builtIn("database"),
  "a.sqlite": builtIn("database"),
  "a.zip": builtIn("zip"),
  "a.tar": builtIn("zip"),
  "a.gz": builtIn("zip"),
  "a.tgz": builtIn("zip"),
  "a.woff": builtIn("font"),
  "a.woff2": builtIn("font"),
  "a.ttf": builtIn("font"),
  "a.otf": builtIn("font"),
  "a.wasm": builtIn("wasm"),
  "a.py": builtIn("python"),
  "a.rs": builtIn("rust"),
  "a.go": builtIn("go"),
  "a.rb": builtIn("ruby"),
  "a.swift": builtIn("swift"),
  "a.zig": builtIn("zig"),
  "a.c": builtIn("c"),
  "a.h": builtIn("c"),
  "a.cpp": builtIn("cpp"),
  "a.hpp": builtIn("cpp"),
  "a.vue": builtIn("vue"),
  "a.svelte": builtIn("svelte"),
  "a.astro": builtIn("astro"),
  "a.graphql": builtIn("graphql"),
  "a.tf": builtIn("terraform"),
  "vite.config.ts": builtIn("vite"),
  "eslint.config.js": builtIn("eslint"),
  ".eslintrc.cjs": builtIn("eslint"),
  ".prettierrc": builtIn("prettier"),
  ".prettierrc.json": builtIn("prettier"),
  "biome.json": builtIn("biome"),
  "biome.jsonc": builtIn("biome"),
  "tailwind.config.js": builtIn("tailwind"),
  "postcss.config.cjs": builtIn("postcss"),
  "webpack.config.js": builtIn("webpack"),
  "next.config.mjs": builtIn("nextjs"),
  ".babelrc": builtIn("babel"),
  ".browserslistrc": builtIn("browserslist"),
  ".stylelintrc.json": builtIn("stylelint"),
  "svgo.config.js": builtIn("svgo"),
  LICENSE: builtIn("default"),
  Makefile: builtIn("default"),
  "a.toml": builtIn("default"),
  "a.unknownext": builtIn("default"),
  noext: builtIn("default"),
  ".somerc": builtIn("default"),
};
const images = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "heic",
];
for (const ext of images) required[`a.${ext}`] = builtIn("image");

/** Mounts the sprite into a minimal fake document and returns what it got. */
function mountSprite() {
  const mounted: { id: string; innerHTML: string }[] = [];
  vi.stubGlobal("document", {
    getElementById: (id: string) => mounted.find((el) => el.id === id) ?? null,
    createElement: () => ({
      id: "",
      innerHTML: "",
      style: {},
      setAttribute() {},
    }),
    body: {
      prepend: (el: { id: string; innerHTML: string }) => mounted.push(el),
    },
  });
  ensureFileIconSprite();
  ensureFileIconSprite();
  return mounted;
}
afterEach(() => vi.unstubAllGlobals());

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("fileIcon", () => {
  it.each(Object.entries(required))("%s shows %s", (path, name) => {
    expect(fileIcon(path).name).toBe(name);
  });

  it("only names symbols the mounted sprite has", () => {
    const [sprite] = mountSprite();
    for (const path of Object.keys(required))
      expect(sprite.innerHTML).toContain(`<symbol id="${fileIcon(path).name}"`);
  });

  it("tints in both themes, readable on light and dark", () => {
    for (const path of Object.keys(required)) {
      const [light, dark] = fileIcon(path).colors;
      expect(light).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(light, "#f7f7f7")).toBeGreaterThanOrEqual(3);
      expect(contrast(dark, "#1c1c1c")).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives unknown, font and custom icons the neutral tint", () => {
    const neutral = fileIcon("LICENSE").colors;
    expect(fileIcon("a.woff2").colors).toEqual(neutral);
    expect(fileIcon("AGENTS.md").colors).toEqual(neutral);
    expect(fileIcon("pnpm-lock.yaml").colors).toEqual(neutral);
    expect(fileIcon("a.ts").colors).not.toEqual(neutral);
  });
});

describe("ensureFileIconSprite", () => {
  it("mounts one sprite however often it is called", () => {
    expect(mountSprite()).toHaveLength(1);
  });

  it("does nothing without a document", () => {
    expect(() => ensureFileIconSprite()).not.toThrow();
  });
});

describe("parentSuffixes", () => {
  const suffixes = (...paths: string[]) =>
    Object.fromEntries(parentSuffixes(paths));

  it("labels only names that occur under more than one path", () => {
    expect(
      suffixes("src/a/index.ts", "src/b/index.ts", "src/c/main.ts"),
    ).toEqual({
      "src/a/index.ts": "src/a",
      "src/b/index.ts": "src/b",
    });
    expect(suffixes("src/a/index.ts", "src/a/index.ts")).toEqual({});
  });

  it("keeps two folders even when one would tell them apart", () => {
    expect(
      suffixes("src/a/x/index.ts", "src/b/x/index.ts", "src/b/y/index.ts"),
    ).toEqual({
      "src/a/x/index.ts": "a/x",
      "src/b/x/index.ts": "b/x",
      "src/b/y/index.ts": "b/y",
    });
  });

  it("grows each label only until it differs", () => {
    expect(
      suffixes(
        "web/src/lib/api.ts",
        "mobile/src/lib/api.ts",
        "mobile/src/ui/api.ts",
      ),
    ).toEqual({
      "web/src/lib/api.ts": "web/src/lib",
      "mobile/src/lib/api.ts": "mobile/src/lib",
      "mobile/src/ui/api.ts": "src/ui",
    });
    expect(suffixes("a/b/c/index.ts", "d/b/c/index.ts")).toEqual({
      "a/b/c/index.ts": "a/b/c",
      "d/b/c/index.ts": "d/b/c",
    });
  });

  it("leaves root files out and uses every parent a short path has", () => {
    expect(suffixes("index.ts", "src/index.ts")).toEqual({
      "src/index.ts": "src",
    });
    expect(suffixes("a/x.ts", "b/a/x.ts")).toEqual({
      "a/x.ts": "a",
      "b/a/x.ts": "b/a",
    });
  });

  it("reads any iterable once", () => {
    function* paths() {
      yield "src/a/index.ts";
      yield "src/b/index.ts";
    }
    expect(parentSuffixes(paths()).size).toBe(2);
  });
});
