// Sample data: someone with three Acme projects in Relay, more Acme repos on
// disk and on GitHub, and a folder that isn't a repository yet.
import type { GithubRepo } from "../../shared/projects";
import { home } from "../linked-folders/linked-folders-data";

export { chats, folderName, home, projects } from "../linked-folders/linked-folders-data";

/** Where clones and new projects go unless changed; Relay remembers the last one. */
export const workFolder = `${home}/work`;

/** Folders on disk, and which of them are git repositories. */
export const disk: Record<string, string[]> = {
  [home]: ["work", "Documents", "Downloads", "PhpstormProjects"],
  [workFolder]: [
    "acme-api",
    "acme-design-tokens",
    "acme-docs",
    "acme-infra",
    "acme-mobile",
    "acme-shared",
    "acme-web",
    "scratch-notes",
  ],
  [`${home}/PhpstormProjects`]: ["openusage", "relay"],
  [`${home}/Documents`]: ["Invoices", "Talks"],
  [`${home}/Downloads`]: [],
};
export const repos = new Set(
  [
    "acme-api",
    "acme-design-tokens",
    "acme-docs",
    "acme-infra",
    "acme-mobile",
    "acme-shared",
    "acme-web",
  ]
    .map((name) => `${workFolder}/${name}`)
    .concat(`${home}/PhpstormProjects/openusage`, `${home}/PhpstormProjects/relay`),
);

const hour = 60 * 60 * 1000;
const ago = (hours: number) => Date.now() - hours * hour;

/** Folders agents worked in lately that aren't Relay projects, newest first. */
export const agentFolders = [
  { path: `${workFolder}/acme-shared`, repository: true, when: ago(2) },
  { path: `${workFolder}/acme-infra`, repository: true, when: ago(26) },
  { path: `${home}/PhpstormProjects/openusage`, repository: true, when: ago(72) },
  { path: `${workFolder}/scratch-notes`, repository: false, when: ago(170) },
];

export const githubLogin = "you";

/** What GitHub lists for the signed-in account and its orgs. */
export const githubRepos: GithubRepo[] = (
  [
    ["acme/acme-web", "Storefront, Next.js", true, 3],
    ["acme/acme-api", "Laravel API", true, 5],
    ["acme/acme-shared", "Types and zod schemas", true, 50],
    ["acme/acme-admin", "Back office, Vue 3", true, 100],
    ["acme/acme-billing", "Stripe webhooks and invoices", true, 180],
    ["acme/design-system", "Figma tokens to CSS", false, 200],
    ["you/dotfiles", "", false, 700],
  ] as const
).map(([full, description, isPrivate, hours]) => ({
  full,
  description,
  private: isPrivate,
  pushed: ago(hours),
  url: `https://github.com/${full}.git`,
}));
