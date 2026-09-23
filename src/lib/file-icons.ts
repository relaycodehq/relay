import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
  type FileTreeIcons,
} from "@pierre/trees";

// Ported from T3 Code's pierre-icons.ts: Pierre's colored file-type icons,
// plus a few names its built-in set leaves generic.
const SPRITE_ID = "relay-file-icon-sprite";

const EXTRA_SPRITE = `
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true">
  <symbol id="relay-file-icon-agents" viewBox="0 0 32 32">
    <path fill="currentColor" d="M27.2 16c0-6.19-5.01-11.2-11.2-11.2C9.81 4.8 4.8 9.81 4.8 16S9.81 27.2 16 27.2c6.19 0 11.2-5.01 11.2-11.2Zm-5.6 2.1a1.4 1.4 0 1 1 0 2.8h-4.2a1.4 1.4 0 1 1 0-2.8Zm-11.2-6.8c.622-.373 1.42-.208 1.84.361l.079.119 2.1 3.5.088.171c.15.351.15.748 0 1.1l-.088.171-2.1 3.5a1.4 1.4 0 0 1-2.4-1.44L11.59 16l-1.67-2.78-.067-.127c-.302-.642-.075-1.42.547-1.79ZM30 16c0 7.73-6.27 14-14 14S2 23.73 2 16 8.27 2 16 2s14 6.27 14 14Z" />
  </symbol>
  <symbol id="relay-file-icon-pnpm" viewBox="0 0 32 32">
    <path fill="#f9ad00" d="M30 10.75h-8.749V2H30Zm-9.626 0h-8.75V2h8.75Zm-9.625 0H2V2h8.749ZM30 20.375h-8.749v-8.75H30Z" />
    <path fill="currentColor" d="M20.374 20.375h-8.75v-8.75h8.75Zm0 9.625h-8.75v-8.75h8.75ZM30 30h-8.749v-8.75H30Zm-19.251 0H2v-8.75h8.749Z" />
  </symbol>
</svg>`;

const ICONS = {
  set: "complete",
  colored: true,
  spriteSheet: EXTRA_SPRITE,
  byFileName: {
    "package.json": "file-tree-builtin-npm",
    "tsconfig.json": "file-tree-builtin-typescript",
    "agents.md": "relay-file-icon-agents",
    "pnpm-lock.yaml": "relay-file-icon-pnpm",
    "pnpm-workspace.yaml": "relay-file-icon-pnpm",
  },
} satisfies FileTreeIcons;

const resolver = createFileTreeIconResolver(ICONS);

/** Icon tints as [light, dark], keyed by the resolver's token. */
const ICON_COLORS: Record<string, readonly [string, string]> = {
  astro: ["#a631be", "#d568ea"],
  babel: ["#d5a910", "#ffd452"],
  bash: ["#199f43", "#5ecc71"],
  biome: ["#1a85d4", "#69b1ff"],
  bootstrap: ["#693acf", "#9d6afb"],
  browserslist: ["#d5a910", "#ffd452"],
  bun: ["#594c5b", "#79697b"],
  c: ["#1a85d4", "#69b1ff"],
  claude: ["#d47628", "#ffa359"],
  cpp: ["#1a85d4", "#69b1ff"],
  css: ["#693acf", "#9d6afb"],
  database: ["#a631be", "#d568ea"],
  default: ["#84848a", "#adadb1"],
  docker: ["#1a85d4", "#69b1ff"],
  eslint: ["#693acf", "#9d6afb"],
  git: ["#ff8c5b", "#d5512f"],
  go: ["#1ca1c7", "#68cdf2"],
  graphql: ["#d32a61", "#ff678d"],
  html: ["#d47628", "#ffa359"],
  image: ["#d32a61", "#ff678d"],
  javascript: ["#d5a910", "#ffd452"],
  json: ["#d47628", "#ffa359"],
  markdown: ["#199f43", "#5ecc71"],
  mcp: ["#17a5af", "#64d1db"],
  nextjs: ["#84848a", "#adadb1"],
  npm: ["#d52c36", "#ff6762"],
  oxc: ["#1ca1c7", "#68cdf2"],
  postcss: ["#d52c36", "#ff6762"],
  prettier: ["#17a5af", "#64d1db"],
  python: ["#1a85d4", "#69b1ff"],
  react: ["#1ca1c7", "#68cdf2"],
  ruby: ["#d52c36", "#ff6762"],
  rust: ["#d47628", "#ffa359"],
  sass: ["#d32a61", "#ff678d"],
  stylelint: ["#84848a", "#adadb1"],
  svelte: ["#d52c36", "#ff6762"],
  svg: ["#d47628", "#ffa359"],
  svgo: ["#199f43", "#5ecc71"],
  swift: ["#d47628", "#ffa359"],
  table: ["#17a5af", "#64d1db"],
  tailwind: ["#1ca1c7", "#68cdf2"],
  terraform: ["#693acf", "#9d6afb"],
  text: ["#84848a", "#adadb1"],
  typescript: ["#1a85d4", "#69b1ff"],
  vite: ["#a631be", "#d568ea"],
  vscode: ["#1a85d4", "#69b1ff"],
  vue: ["#199f43", "#5ecc71"],
  wasm: ["#693acf", "#9d6afb"],
  webpack: ["#1a85d4", "#69b1ff"],
  yml: ["#d52c36", "#ff6762"],
  zig: ["#d47628", "#ffa359"],
  zip: ["#d47628", "#ffa359"],
};

export type FileIcon = {
  /** Sprite symbol id. */
  name: string;
  colors: readonly [light: string, dark: string];
};

export function fileIcon(path: string): FileIcon {
  const icon = resolver.resolveIcon("file-tree-icon-file", path);
  // Name overrides (package.json → npm) come back without a token.
  const token = icon.token ?? icon.name.replace(/^file-tree-builtin-/, "");
  return {
    name: icon.name,
    colors: ICON_COLORS[token] ?? ICON_COLORS.default!,
  };
}

/** Mounts the shared sprite once; icons reference its symbols with <use>. */
export function ensureFileIconSprite() {
  if (typeof document === "undefined" || document.getElementById(SPRITE_ID))
    return;
  const container = document.createElement("div");
  container.id = SPRITE_ID;
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  container.innerHTML = `${getBuiltInSpriteSheet("complete")}${EXTRA_SPRITE}`;
  document.body.prepend(container);
}

/**
 * For file names that appear under more than one path, the shortest parent
 * suffix (at least two folders) that tells them apart. Unique names get none.
 */
export function parentSuffixes(paths: Iterable<string>): Map<string, string> {
  const byName = new Map<string, Set<string>>();
  for (const path of paths) {
    const name = path.split("/").at(-1);
    if (!name) continue;
    byName.set(name, (byName.get(name) ?? new Set()).add(path));
  }
  const suffixes = new Map<string, string>();
  for (const group of byName.values()) {
    if (group.size < 2) continue;
    const parents = new Map(
      [...group].map((path) => [path, path.split("/").slice(0, -1)]),
    );
    for (const [path, segments] of parents) {
      if (!segments.length) continue;
      let depth = 1;
      while (
        depth < segments.length &&
        [...parents].some(
          ([other, otherSegments]) =>
            other !== path &&
            otherSegments.slice(-depth).join("/") ===
              segments.slice(-depth).join("/"),
        )
      )
        depth++;
      suffixes.set(
        path,
        segments
          .slice(-Math.min(segments.length, Math.max(depth, 2)))
          .join("/"),
      );
    }
  }
  return suffixes;
}
