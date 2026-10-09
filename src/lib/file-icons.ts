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

/** Languages the library has no icon for, drawn on its 16px grid. */
const drawn = {
  dart: {
    tint: "cyan",
    body: `<path fill="currentColor" d="M4.6 1.6h6l3.8 3.8v6z" opacity=".5"/><path fill="currentColor" d="M1.6 4.6l3-3 9.8 9.8v3H5L1.6 11z"/>`,
  },
  php: {
    tint: "indigo",
    body: `<ellipse cx="8" cy="8" rx="7" ry="5" fill="currentColor" opacity=".35"/><path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" d="M3.4 11.2V6.4h1.2a1.2 1.2 0 0 1 0 2.4H3.4M6.8 4.8v4.6m0-2.3c0-.6.4-.9 1-.9s1 .3 1 .9v2.3M10.3 11.2V6.4h1.2a1.2 1.2 0 0 1 0 2.4h-1.2"/>`,
  },
  kotlin: {
    tint: "purple",
    body: `<path fill="currentColor" d="M2 2h12L8 8l6 6H2z"/>`,
  },
  java: {
    tint: "orange",
    body: `<path fill="currentColor" d="M3.2 7.4h7.3v2.2a3.6 3.6 0 0 1-3.6 3.6h-.1a3.6 3.6 0 0 1-3.6-3.6z"/><path fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" d="M10.5 8.3h.9a1.4 1.4 0 0 1 0 2.8h-1.2M2.6 14.6h8.6M5.5 5.8c-.8-.9.7-1.5 0-2.5M8 5.8c-.9-1.2 1-1.9-.1-3.5"/>`,
  },
  csharp: {
    tint: "purple",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M8.7 4.9a3.9 3.9 0 1 0 0 6.2"/><path fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" d="M11.4 5.6v4.8m2.1-4.8v4.8m-3.2-3.3h4.3m-4.3 1.8h4.3"/>`,
  },
  lua: {
    tint: "blue",
    body: `<path fill="currentColor" fill-rule="evenodd" d="M7 3.6a5.6 5.6 0 1 1 0 11.2 5.6 5.6 0 0 1 0-11.2m2.2 1.7a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2"/><circle cx="13.4" cy="2.6" r="1.5" fill="currentColor"/>`,
  },
  elixir: {
    tint: "purple",
    body: `<path fill="currentColor" d="M8 1C5.9 3.9 3.6 6.9 3.6 10.1a4.4 4.4 0 0 0 8.8 0C12.4 6.9 10.1 3.9 8 1"/>`,
  },
  scala: {
    tint: "red",
    body: `<path fill="currentColor" d="M3.5 2.4 12.5 1v3L3.5 5.4zm0 8.8 9-1.4v3l-9 1.4z"/><path fill="currentColor" opacity=".6" d="m3.5 6.8 9-1.4v3l-9 1.4z"/>`,
  },
  haskell: {
    tint: "purple",
    body: `<path fill="currentColor" opacity=".6" d="M1 2.5h2.4L7.2 8l-3.8 5.5H1L4.8 8z"/><path fill="currentColor" d="M4.8 2.5h2.4l7.6 11h-2.4L10 10l-2.4 3.5H5.2L8.8 8.3z"/><path fill="currentColor" opacity=".8" d="M11.3 5.3H15v1.4h-2.7zm1.3 2.6H15v1.4h-1.4z"/>`,
  },
  xml: {
    tint: "amber",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M4.8 4.6 1.6 8l3.2 3.4m6.4-6.8L14.4 8l-3.2 3.4M9.3 3.4l-2.6 9.2"/>`,
  },
} as const satisfies Record<
  string,
  { tint: keyof typeof palette; body: string }
>;
type Drawn = keyof typeof drawn;

const drawnPrefix = "relay-file-icon-lang-";
const lang = (name: Drawn) => drawnPrefix + name;

/** Symbols the library has no icon for, in its sprite format. */
const extraSprite = `<svg aria-hidden="true" width="0" height="0">${Object.entries(
  drawn,
)
  .map(
    ([name, { body }]) =>
      `<symbol id="${lang(name as Drawn)}" viewBox="0 0 16 16">${body}</symbol>`,
  )
  .join("")}<symbol id="${agentsIcon}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12.6" fill="none" stroke="currentColor" stroke-width="2.8"/><path d="M10.5 11.5 15 16l-4.5 4.5M17.5 20.5h4.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></symbol><symbol id="${pnpmIcon}" viewBox="0 0 32 32">${pnpmCells
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
    "pubspec.yaml": lang("dart"),
    "pubspec.lock": lang("dart"),
    "analysis_options.yaml": lang("dart"),
    "composer.json": lang("php"),
    "composer.lock": lang("php"),
    artisan: lang("php"),
    gradlew: lang("java"),
    "gradlew.bat": lang("java"),
    "pom.xml": lang("java"),
    "mix.exs": lang("elixir"),
    "mix.lock": lang("elixir"),
    "build.sbt": lang("scala"),
  },
  byFileExtension: {
    heic: icon("image"),
    ipynb: icon("python"),
    ps1: icon("bash"),
    bat: icon("bash"),
    cmd: icon("bash"),
    dart: lang("dart"),
    php: lang("php"),
    phtml: lang("php"),
    kt: lang("kotlin"),
    kts: lang("kotlin"),
    java: lang("java"),
    gradle: lang("java"),
    cs: lang("csharp"),
    csx: lang("csharp"),
    csproj: lang("csharp"),
    sln: lang("csharp"),
    razor: lang("csharp"),
    cshtml: lang("csharp"),
    lua: lang("lua"),
    luau: lang("lua"),
    ex: lang("elixir"),
    exs: lang("elixir"),
    heex: lang("elixir"),
    scala: lang("scala"),
    sc: lang("scala"),
    sbt: lang("scala"),
    hs: lang("haskell"),
    lhs: lang("haskell"),
    cabal: lang("haskell"),
    xml: lang("xml"),
    xaml: lang("xml"),
    xsd: lang("xml"),
    xsl: lang("xml"),
    plist: lang("xml"),
    storyboard: lang("xml"),
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
  indigo: ["#5559a8", "#9a9ee0"],
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
    (name.startsWith(builtIn) && tints[name.slice(builtIn.length)]) ||
      (name.startsWith(drawnPrefix) &&
        drawn[name.slice(drawnPrefix.length) as Drawn]?.tint) ||
      "grey"
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
