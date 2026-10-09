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

/**
 * Languages the library has no icon for. The marks come from Simple Icons
 * (CC0, Java from v6 before it was removed) on their 24px grid; Dart is traced
 * from its logo so it keeps the two tones, and XML has no mark of its own.
 */
const drawn = {
  dart: {
    tint: "cyan",
    body: `<path fill="currentColor" opacity=".6" d="M3.5 3.5 8.6 1h1.25l2.05 2.5zm0 0h8.4L15 6.6v5.9h-2.5zm0 0L1.2 7.8l.2 1.2 2.1 2.2z"/><path fill="currentColor" d="m3.5 3.5 9 9V15H6.6l-3.1-3.8z"/>`,
  },
  php: {
    tint: "indigo",
    box: 24,
    body: `<path fill="currentColor" d="M7.01 10.207h-.944l-.515 2.648h.838c.556 0 .97-.105 1.242-.314.272-.21.455-.559.55-1.049.092-.47.05-.802-.124-.995-.175-.193-.523-.29-1.047-.29zM12 5.688C5.373 5.688 0 8.514 0 12s5.373 6.313 12 6.313S24 15.486 24 12c0-3.486-5.373-6.312-12-6.312zm-3.26 7.451c-.261.25-.575.438-.917.551-.336.108-.765.164-1.285.164H5.357l-.327 1.681H3.652l1.23-6.326h2.65c.797 0 1.378.209 1.744.628.366.418.476 1.002.33 1.752a2.836 2.836 0 0 1-.305.847c-.143.255-.33.49-.561.703zm4.024.715l.543-2.799c.063-.318.039-.536-.068-.651-.107-.116-.336-.174-.687-.174H11.46l-.704 3.625H9.388l1.23-6.327h1.367l-.327 1.682h1.218c.767 0 1.295.134 1.586.401s.378.7.263 1.299l-.572 2.944h-1.389zm7.597-2.265a2.782 2.782 0 0 1-.305.847c-.143.255-.33.49-.561.703a2.44 2.44 0 0 1-.917.551c-.336.108-.765.164-1.286.164h-1.18l-.327 1.682h-1.378l1.23-6.326h2.649c.797 0 1.378.209 1.744.628.366.417.477 1.001.331 1.751zM17.766 10.207h-.943l-.516 2.648h.838c.557 0 .971-.105 1.242-.314.272-.21.455-.559.551-1.049.092-.47.049-.802-.125-.995s-.524-.29-1.047-.29z"/>`,
  },
  kotlin: {
    tint: "purple",
    box: 24,
    body: `<path fill="currentColor" d="M24 24H0V0h24L12 12Z"/>`,
  },
  java: {
    tint: "orange",
    box: 24,
    body: `<path fill="currentColor" d="M8.851 18.56s-.917.534.653.714c1.902.218 2.874.187 4.969-.211 0 0 .552.346 1.321.646-4.699 2.013-10.633-.118-6.943-1.149M8.276 15.933s-1.028.761.542.924c2.032.209 3.636.227 6.413-.308 0 0 .384.389.987.602-5.679 1.661-12.007.13-7.942-1.218M13.116 11.475c1.158 1.333-.304 2.533-.304 2.533s2.939-1.518 1.589-3.418c-1.261-1.772-2.228-2.652 3.007-5.688 0-.001-8.216 2.051-4.292 6.573M19.33 20.504s.679.559-.747.991c-2.712.822-11.288 1.069-13.669.033-.856-.373.75-.89 1.254-.998.527-.114.828-.093.828-.093-.953-.671-6.156 1.317-2.643 1.887 9.58 1.553 17.462-.7 14.977-1.82M9.292 13.21s-4.362 1.036-1.544 1.412c1.189.159 3.561.123 5.77-.062 1.806-.152 3.618-.477 3.618-.477s-.637.272-1.098.587c-4.429 1.165-12.986.623-10.522-.568 2.082-1.006 3.776-.892 3.776-.892M17.116 17.584c4.503-2.34 2.421-4.589.968-4.285-.355.074-.515.138-.515.138s.132-.207.385-.297c2.875-1.011 5.086 2.981-.928 4.562 0-.001.07-.062.09-.118M14.401 0s2.494 2.494-2.365 6.33c-3.896 3.077-.888 4.832-.001 6.836-2.274-2.053-3.943-3.858-2.824-5.539 1.644-2.469 6.197-3.665 5.19-7.627M9.734 23.924c4.322.277 10.959-.153 11.116-2.198 0 0-.302.775-3.572 1.391-3.688.694-8.239.613-10.937.168 0-.001.553.457 3.393.639"/>`,
  },
  csharp: {
    tint: "purple",
    box: 24,
    body: `<path fill="currentColor" d="M1.194 7.543v8.913c0 1.103.588 2.122 1.544 2.674l7.718 4.456a3.086 3.086 0 0 0 3.088 0l7.718-4.456a3.087 3.087 0 0 0 1.544-2.674V7.543a3.084 3.084 0 0 0-1.544-2.673L13.544.414a3.086 3.086 0 0 0-3.088 0L2.738 4.87a3.085 3.085 0 0 0-1.544 2.673Zm5.403 2.914v3.087a.77.77 0 0 0 .772.772.773.773 0 0 0 .772-.772.773.773 0 0 1 1.317-.546.775.775 0 0 1 .226.546 2.314 2.314 0 1 1-4.631 0v-3.087c0-.615.244-1.203.679-1.637a2.312 2.312 0 0 1 3.274 0c.434.434.678 1.023.678 1.637a.769.769 0 0 1-.226.545.767.767 0 0 1-1.091 0 .77.77 0 0 1-.226-.545.77.77 0 0 0-.772-.772.771.771 0 0 0-.772.772Zm12.35 3.087a.77.77 0 0 1-.772.772h-.772v.772a.773.773 0 0 1-1.544 0v-.772h-1.544v.772a.773.773 0 0 1-1.317.546.775.775 0 0 1-.226-.546v-.772H12a.771.771 0 1 1 0-1.544h.772v-1.543H12a.77.77 0 1 1 0-1.544h.772v-.772a.773.773 0 0 1 1.317-.546.775.775 0 0 1 .226.546v.772h1.544v-.772a.773.773 0 0 1 1.544 0v.772h.772a.772.772 0 0 1 0 1.544h-.772v1.543h.772a.776.776 0 0 1 .772.772Zm-3.088-2.315h-1.544v1.543h1.544v-1.543Z"/>`,
  },
  lua: {
    tint: "blue",
    box: 24,
    body: `<path fill="currentColor" d="M.38 10.377l-.272-.037c-.048.344-.082.695-.101 1.041l.275.016c.018-.34.051-.682.098-1.02zM4.136 3.289l-.184-.205c-.258.232-.509.48-.746.734l.202.188c.231-.248.476-.49.728-.717zM5.769 2.059l-.146-.235c-.296.186-.586.385-.863.594l.166.219c.27-.203.554-.399.843-.578zM1.824 18.369c.185.297.384.586.593.863l.22-.164c-.205-.271-.399-.555-.58-.844l-.233.145zM1.127 16.402l-.255.104c.129.318.274.635.431.943l.005.01.245-.125-.005-.01c-.153-.301-.295-.611-.421-.922zM.298 9.309l.269.063c.076-.332.168-.664.272-.986l-.261-.087c-.108.332-.202.672-.28 1.01zM.274 12.42l-.275.01c.012.348.04.699.083 1.043l.273-.033c-.042-.336-.069-.68-.081-1.02zM.256 14.506c.073.34.162.682.264 1.014l.263-.08c-.1-.326-.187-.658-.258-.99l-.269.056zM11.573.275L11.563 0c-.348.012-.699.039-1.044.082l.034.273c.338-.041.68-.068 1.02-.08zM23.221 8.566c.1.326.186.66.256.992l.27-.059c-.072-.34-.16-.682-.262-1.014l-.264.081zM17.621 1.389c-.309-.164-.627-.314-.947-.449l-.107.252c.314.133.625.281.926.439l.128-.242zM15.693.572c-.332-.105-.67-.199-1.01-.277l-.063.268c.332.076.664.168.988.273l.085-.264zM6.674 1.545c.298-.15.606-.291.916-.418L7.486.873c-.317.127-.632.272-.937.428l-.015.008.125.244.015-.008zM23.727 11.588l.275-.01a11.797 11.797 0 0 0-.082-1.045l-.273.033c.041.338.068.682.08 1.022zM13.654.105c-.346-.047-.696-.08-1.043-.098l-.014.273c.339.018.683.051 1.019.098l.038-.273zM9.544.527l-.058-.27c-.34.072-.681.16-1.014.264l.081.262c.325-.099.659-.185.991-.256zM1.921 5.469l.231.15c.185-.285.384-.566.592-.834l-.217-.17c-.213.276-.417.563-.606.854zM.943 7.318l.253.107c.132-.313.28-.625.439-.924l-.243-.128c-.163.307-.314.625-.449.945zM18.223 21.943l.145.234c.295-.186.586-.385.863-.594l-.164-.219c-.272.204-.557.4-.844.579zM21.248 19.219l.217.17c.215-.273.418-.561.607-.854l-.23-.148c-.186.285-.385.564-.594.832zM19.855 20.715l.184.203c.258-.23.51-.479.746-.732l-.201-.188c-.23.248-.477.488-.729.717zM22.359 17.504l.244.129c.162-.307.314-.625.449-.945l-.254-.107a11.27 11.27 0 0 1-.439.923zM23.617 13.629l.273.039c.049-.346.082-.695.102-1.043l-.275-.014c-.018.338-.051.682-.1 1.018zM23.156 15.621l.264.086c.107-.332.201-.67.279-1.01l-.268-.063c-.077.333-.169.665-.275.987zM22.453 6.672c.154.303.297.617.424.932l.256-.104c-.131-.322-.277-.643-.436-.953l-.244.125zM8.296 23.418c.331.107.67.201 1.009.279l.062-.268c-.331-.076-.663-.168-.986-.273l-.085.262zM10.335 23.889c.345.049.696.082 1.043.102l.014-.275c-.339-.018-.682-.051-1.019-.098l-.038.271zM17.326 22.449c-.303.154-.613.297-.926.424l.104.256c.318-.131.639-.275.947-.434l.004-.002-.123-.246-.006.002zM4.613 21.467c.274.213.562.418.854.605l.149-.23c-.285-.184-.565-.385-.833-.592l-.17.217zM12.417 23.725l.009.275c.348-.014.699-.041 1.045-.084l-.035-.271c-.336.041-.68.068-1.019.08zM6.37 22.604c.307.162.625.314.946.449l.107-.254c-.313-.133-.624-.279-.924-.439l-.129.244zM3.083 20.041c.233.258.48.51.734.746l.188-.201c-.249-.23-.49-.477-.717-.729l-.205.184zM14.445 23.475l.059.27c.34-.074.68-.162 1.014-.266l-.082-.262c-.325.099-.659.185-.991.258zM21.18.129A2.689 2.689 0 1 0 21.18 5.507 2.689 2.689 0 1 0 21.18.129zM15.324 15.447c0 .471.314.66.852.66.67 0 1.297-.396 1.297-1.016v-.645c-.23.107-.379.141-1.107.24-.735.109-1.042.306-1.042.761zM12 2.818c-5.07 0-9.18 4.109-9.18 9.18 0 5.068 4.11 9.18 9.18 9.18 5.07 0 9.18-4.111 9.18-9.18 0-5.07-4.11-9.18-9.18-9.18zm-2.487 13.77H5.771v-6.023h.769v5.346h2.974v.677zm4.13 0h-.619v-.67c-.405.57-.811.793-1.446.793-.843 0-1.38-.463-1.38-1.182v-3.271h.686v3c0 .52.347.85.893.85.719 0 1.181-.578 1.181-1.461v-2.389h.686v4.33zm-.53-8.393c0-1.484 1.205-2.689 2.689-2.689s2.688 1.205 2.688 2.689-1.203 2.688-2.688 2.688-2.689-1.203-2.689-2.688zm5.567 7.856v.52c-.223.059-.33.074-.471.074-.34 0-.637-.238-.711-.57-.381.406-.918.637-1.471.637-.877 0-1.422-.463-1.422-1.248 0-.527.256-.916.76-1.123.266-.107.414-.141 1.389-.264.545-.066.719-.191.719-.48v-.182c0-.412-.348-.645-.967-.645-.645 0-.957.24-1.016.77h-.693c.041-1 .686-1.404 1.734-1.404 1.066 0 1.627.412 1.627 1.182v2.412c0 .215.133.338.373.338.041-.002.074-.002.149-.017z"/>`,
  },
  elixir: {
    tint: "purple",
    box: 24,
    body: `<path fill="currentColor" d="M19.793 16.575c0 3.752-2.927 7.426-7.743 7.426-5.249 0-7.843-3.71-7.843-8.29 0-5.21 3.892-12.952 8-15.647a.397.397 0 0 1 .61.371 9.716 9.716 0 0 0 1.694 6.518c.522.795 1.092 1.478 1.763 2.352.94 1.227 1.637 1.906 2.644 3.842l.015.028a7.107 7.107 0 0 1 .86 3.4z"/>`,
  },
  scala: {
    tint: "red",
    box: 24,
    body: `<path fill="currentColor" d="M4.589 24c4.537 0 13.81-1.516 14.821-3v-5.729c-.957 1.408-10.284 2.912-14.821 2.912V24zM4.589 16.365c4.537 0 13.81-1.516 14.821-3V7.636c-.957 1.408-10.284 2.912-14.821 2.912v5.817zM4.589 8.729c4.537 0 13.81-1.516 14.821-3V0C18.453 1.408 9.126 2.912 4.589 2.912v5.817z"/>`,
  },
  haskell: {
    tint: "purple",
    box: 24,
    body: `<path fill="currentColor" d="M0 3.535L5.647 12 0 20.465h4.235L9.883 12 4.235 3.535zm5.647 0L11.294 12l-5.647 8.465h4.235l3.53-5.29 3.53 5.29h4.234L9.883 3.535zm8.941 4.938l1.883 2.822H24V8.473zm2.824 4.232l1.882 2.822H24v-2.822z"/>`,
  },
  xml: {
    tint: "amber",
    body: `<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M4.8 4.6 1.6 8l3.2 3.4m6.4-6.8L14.4 8l-3.2 3.4M9.3 3.4l-2.6 9.2"/>`,
  },
} as const satisfies Record<
  string,
  { tint: keyof typeof palette; box?: number; body: string }
>;
type Drawn = keyof typeof drawn;

const drawnPrefix = "relay-file-icon-lang-";
const lang = (name: Drawn) => drawnPrefix + name;

/** Symbols the library has no icon for, in its sprite format. */
const extraSprite = `<svg aria-hidden="true" width="0" height="0">${Object.entries(
  drawn,
)
  .map(([name, icon]) => {
    const box = "box" in icon ? icon.box : 16;
    return `<symbol id="${lang(name as Drawn)}" viewBox="0 0 ${box} ${box}">${icon.body}</symbol>`;
  })
  .join(
    "",
  )}<symbol id="${agentsIcon}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12.6" fill="none" stroke="currentColor" stroke-width="2.8"/><path d="M10.5 11.5 15 16l-4.5 4.5M17.5 20.5h4.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></symbol><symbol id="${pnpmIcon}" viewBox="0 0 32 32">${pnpmCells
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
