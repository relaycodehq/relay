// Sample plugins for the Plugins page preview. Clockify mirrors the real
// plugin's settings; Azure DevOps stands in for the planned second plugin.
import { Puzzle, SquareKanban, Timer, type LucideIcon } from "lucide-react";

export type PluginId = "clockify" | "devops";

export interface ClockifyState {
  on: boolean;
  key: boolean;
  account: string;
  region: string;
  workspace: string;
  quiet: number;
  projects: Record<string, string>;
}

export interface DevopsState {
  on: boolean;
  pat: boolean;
  org: string;
  project: string;
  mine: boolean;
  insert: "link" | "title";
}

export interface PluginsState {
  clockify: ClockifyState;
  devops: DevopsState;
}

export const meta: Record<
  PluginId,
  {
    title: string;
    /** For the nav, where the full title doesn't fit. */
    short: string;
    tagline: string;
    description: string;
    icon: LucideIcon;
  }
> = {
  clockify: {
    title: "Clockify time tracking",
    short: "Clockify",
    tagline: "Your day's hours, split across projects and sent to Clockify.",
    description:
      "Start a timer in the morning; at the end of the day Relay splits it across your projects from the threads you worked in, drafts each entry and sends them to Clockify once you've checked them.",
    icon: Timer,
  },
  devops: {
    title: "Azure DevOps work items",
    short: "Azure DevOps",
    tagline: "Your boards' tasks and bugs, one keystroke from the composer.",
    description:
      "Pick a work item while you write and Relay hands the agent its title, description and acceptance criteria, then links the commit back to it.",
    icon: SquareKanban,
  },
};
export const pluginIds = Object.keys(meta) as PluginId[];
export const PluginsIcon = Puzzle;

export const regions = ["Global", "EU", "USA", "UK", "Australia"];
export const workspaces = ["Contoso", "Personal"];
export const relayProjects = [
  "Flowise",
  "Onboarding",
  "Licensing",
  "Website",
  "Relay",
  "Admin console",
  "Docs",
  "Mobile SDK",
  "Scratchpad",
].map((name) => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name }));
export const clockifyProjects = [
  { id: "web", name: "Web Apps", client: "Contoso", color: "#4f8bf5" },
  { id: "mobile", name: "Mobile Apps", client: "Contoso", color: "#e0913b" },
  { id: "lic", name: "Licensing portal", client: "Contoso", color: "#b77de8" },
  { id: "internal", name: "Internal tools", color: "#7bc47f" },
];
export const devopsProjects = ["Contoso", "Platform", "Mobile"];

export const connected: PluginsState = {
  clockify: {
    on: true,
    key: true,
    account: "Sample Person",
    region: "Global",
    workspace: "Contoso",
    quiet: 20,
    projects: {
      flowise: "web",
      onboarding: "mobile",
      licensing: "lic",
      website: "web",
      "admin-console": "web",
      "mobile-sdk": "mobile",
    },
  },
  devops: {
    on: true,
    pat: true,
    org: "contoso",
    project: "Contoso",
    mine: true,
    insert: "link",
  },
};

export const fresh: PluginsState = {
  clockify: {
    on: true,
    key: false,
    account: "",
    region: "Global",
    workspace: "",
    quiet: 20,
    projects: {},
  },
  devops: { ...connected.devops, on: false, pat: false, org: "", project: "" },
};

/** One muted line of where a plugin stands, for collapsed headers. */
export function status(id: PluginId, s: PluginsState): string {
  if (id === "clockify") {
    const c = s.clockify;
    if (!c.on) return "Off";
    if (!c.key) return "Needs an API key";
    if (!c.workspace) return "Pick a workspace";
    const n = Object.keys(c.projects).length;
    return n
      ? `${c.account} · ${c.workspace} · ${n} of ${relayProjects.length} projects tracked`
      : "No projects tracked yet";
  }
  const d = s.devops;
  if (!d.on) return "Off";
  if (!d.pat || !d.org) return "Needs an organization and token";
  return `${d.org} / ${d.project} · ${d.mine ? "assigned to you" : "everyone's items"}`;
}

export const needsSetup = (id: PluginId, s: PluginsState) =>
  s[id].on && /^Needs|^Pick|^No projects/.test(status(id, s));
