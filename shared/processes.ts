import type { AgentProvider } from "./agents";
import type { TaskKind } from "./tasks";

/** What a group of processes costs right now. */
export interface ProcessCost {
  /** % of one core, as Activity Monitor and Task Manager's details count it; missing until a second look on Linux. */
  cpu?: number;
  /** Resident memory; Windows' private working set. */
  mb: number;
}

/** One line on the Processes page: a process and whatever it started, counted together. */
export interface ProcessEntry extends ProcessCost {
  /** `pid:started` of the process it starts from, or a listed task's id. */
  id: string;
  /** agent: an agent's CLI; task: a command left running (Running card's list); app: Relay's own; helper: something else Relay or an agent runs. */
  kind: "agent" | "task" | "app" | "helper";
  title: string;
  /** The task's command or the helper's command line. */
  command?: string;
  agent?: AgentProvider;
  taskKind?: TaskKind;
  thread?: { id: string; title: string };
  started: number;
  ports: number[];
  /** How many processes it counts. */
  processes: number;
  /** A task still running though whatever started it is gone, or its thread settled. */
  leftBehind?: "starter-gone" | "settled";
}

export interface ProcessFolder extends ProcessCost {
  path: string;
  /** The thread whose worktree this is; missing for the project's own checkout. */
  thread?: { id: string; title: string };
  entries: ProcessEntry[];
}

export interface ProjectProcesses extends ProcessCost {
  projectId: string;
  name: string;
  folders: ProcessFolder[];
}

export interface ProcessOverview {
  at: number;
  /** Projects with something running, the costliest first. */
  projects: ProjectProcesses[];
  /** Relay itself, its helpers, and agents working outside any project. */
  relay: ProcessCost & { entries: ProcessEntry[] };
  /** Everything above together. */
  total: ProcessCost;
  machine: { cores: number; totalMb: number };
  platform: "darwin" | "linux" | "win32" | "other";
}

export interface ProcessesApi {
  /** What Relay and its agents have running, across every project and worktree. */
  processOverview(): Promise<ProcessOverview>;
}

/** Adds up costs; CPU stays unknown only when every part's is. */
export function addCosts(costs: readonly ProcessCost[]): ProcessCost {
  let cpu: number | undefined;
  let mb = 0;
  for (const c of costs) {
    mb += c.mb;
    if (c.cpu !== undefined) cpu = (cpu ?? 0) + c.cpu;
  }
  return cpu === undefined ? { mb } : { cpu, mb };
}

/** "1.4 GB", "380 MB". */
export function formatMemory(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** "142%", "3.1%", "0%": one core is 100%. */
export function formatCpu(cpu: number | undefined) {
  if (cpu === undefined) return "–";
  if (cpu >= 10) return `${Math.round(cpu)}%`;
  if (cpu < 0.05) return "0%";
  return `${cpu.toFixed(1)}%`;
}
