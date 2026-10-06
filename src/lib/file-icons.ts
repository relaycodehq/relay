import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
} from "@pierre/trees";

export type FileIcon = {
  /** Sprite symbol id to reference with <use href="#name">. */
  name: string;
  /** Tint as [light-theme colour, dark-theme colour]. */
  colors: readonly [light: string, dark: string];
};

const builtIn = "file-tree-builtin-";
const agentsIcon = "relay-file-icon-agents";
const pnpmIcon = "relay-file-icon-pnpm";

const pnpmCells = [
  [2, 2, true],
  [11.625, 2, true],
  [21.25, 2, true],
  [21.25, 11.625, true],
  [11.625, 11.625, false],
  [2, 21.25, false],
  [11.625, 21.25, false],
  [21.25, 21.25, false],
] as const;

/** Symbols the library has no icon for, in its sprite format. */
const extraSprite = `<svg aria-hidden="true" width="0" height="0"><symbol id="${agentsIcon}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12.6" fill="none" stroke="currentColor" stroke-width="2.8"/><path d="M10.5 11.5 15 16l-4.5 4.5M17.5 20.5h4.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></symbol><symbol id="${pnpmIcon}" viewBox="0 0 32 32">${pnpmCells
  .map(
    ([x, y, amber]) =>
      `<rect x="${x}" y="${y}" width="8.75" height="8.75" fill="${amber ? "#f9ad00" : "currentColor"}"/>`,
  )
  .join("")}</symbol></svg>`;

const icon = (token: string) => builtIn + token;

const resolver = createFileTreeIconResolver({
  set: "complete",
  colored: true,
  byFileName: {
    "package.json": icon("npm"),
    "package-lock.json": icon("npm"),
    ".npmrc": icon("npm"),
    "tsconfig.json": icon("typescript"),
    "jsconfig.json": icon("typescript"),
    "agents.md": agentsIcon,
    "pnpm-lock.yaml": pnpmIcon,
    "pnpm-workspace.yaml": pnpmIcon,
    ".mcp.json": icon("mcp"),
    "compose.yml": icon("docker"),
    "compose.yaml": icon("docker"),
    "cargo.toml": icon("rust"),
    "cargo.lock": icon("rust"),
    "go.mod": icon("go"),
    "go.sum": icon("go"),
    "gemfile.lock": icon("ruby"),
    "pyproject.toml": icon("python"),
    "requirements.txt": icon("python"),
  },
  byFileExtension: {
    heic: icon("image"),
  },
});

const palette = {
  grey: ["#687079", "#9aa2ab"],
  blue: ["#2f6fc0", "#6ea8f2"],
  cyan: ["#0a7d99", "#5cc6e4"],
  teal: ["#0d7a6c", "#4cc3ae"],
  green: ["#2d7f3e", "#6cc47e"],
  yellow: ["#8f6c00", "#e5c54a"],
  amber: ["#a85d06", "#eea64a"],
  orange: ["#c24d26", "#ef8a60"],
  red: ["#c0352f", "#f0726b"],
  pink: ["#b8377f", "#ec80bc"],
  purple: ["#6a4ccc", "#a993f5"],
} as const satisfies Record<string, readonly [string, string]>;

/** Each built-in token's brand hue; anything not listed is neutral grey. */
const tints: Record<string, keyof typeof palette> = {
  astro: "orange",
  babel: "yellow",
  bash: "green",
  biome: "blue",
  bootstrap: "purple",
  browserslist: "amber",
  bun: "amber",
  c: "blue",
  claude: "orange",
  cpp: "blue",
  css: "blue",
  database: "teal",
  docker: "blue",
  eslint: "purple",
  git: "orange",
  go: "cyan",
  graphql: "pink",
  html: "orange",
  image: "purple",
  javascript: "yellow",
  json: "yellow",
  markdown: "green",
  mcp: "teal",
  npm: "red",
  oxc: "cyan",
  postcss: "red",
  prettier: "teal",
  python: "blue",
  react: "cyan",
  ruby: "red",
  rust: "orange",
  sass: "pink",
  svelte: "orange",
  svg: "amber",
  svgo: "blue",
  swift: "orange",
  table: "green",
  tailwind: "cyan",
  terraform: "purple",
  typescript: "blue",
  vite: "purple",
  vscode: "blue",
  vue: "green",
  wasm: "purple",
  webpack: "blue",
  yml: "red",
  zig: "amber",
  zip: "amber",
};

const tintOf = (name: string) =>
  palette[
    (name.startsWith(builtIn) && tints[name.slice(builtIn.length)]) || "grey"
  ];

/**
 * Whole-name families the resolver can't express: its "name contains" rules
 * win over extensions, so `docker-compose.test.ts` would get the Docker icon.
 */
const nameFamilies: [RegExp, string][] = [
  // The library knows a few .env variants; every one of them is plain text.
  [/^\.env(\..+)?$/, icon("text")],
  [/^(dockerfile(\..+)?|.+\.dockerfile)$/, icon("docker")],
  [/^docker-compose(\.[\w-]+)*\.ya?ml$/, icon("docker")],
  [/^tsconfig\..+\.json$/, icon("typescript")],
];

/** Icon for a file path; only the file name and extension count. */
export function fileIcon(path: string): FileIcon {
  const base = (path.split("/").at(-1) ?? path).toLowerCase();
  const name =
    nameFamilies.find(([pattern]) => pattern.test(base))?.[1] ??
    resolver.resolveIcon("file-tree-icon-file", path).name;
  return { name, colors: tintOf(name) };
}

const spriteId = "relay-file-icon-sprite";

/** Mounts the shared sprite once; does nothing without a document. */
export function ensureFileIconSprite() {
  if (typeof document === "undefined" || document.getElementById(spriteId))
    return;
  const holder = document.createElement("div");
  holder.id = spriteId;
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  holder.innerHTML = getBuiltInSpriteSheet("complete") + extraSprite;
  document.body.prepend(holder);
}

/**
 * For files that share a name, the shortest run of parent folders that tells
 * each apart (at least two when it has them). Unique names, and files in the
 * root, get no entry.
 */
export function parentSuffixes(paths: Iterable<string>): Map<string, string> {
  const byName = new Map<string, string[][]>();
  for (const path of new Set(paths)) {
    const parts = path.split("/");
    const name = parts.pop()!;
    byName.set(name, [...(byName.get(name) ?? []), parts]);
  }
  const suffixes = new Map<string, string>();
  for (const [name, folders] of byName) {
    if (folders.length < 2) continue;
    for (const parents of folders) {
      if (!parents.length) continue;
      const tail = (of: string[], depth: number) => of.slice(-depth).join("/");
      let depth = Math.min(2, parents.length);
      while (
        depth < parents.length &&
        folders.some(
          (other) =>
            other !== parents && tail(other, depth) === tail(parents, depth),
        )
      )
        depth++;
      suffixes.set([...parents, name].join("/"), tail(parents, depth));
    }
  }
  return suffixes;
}
