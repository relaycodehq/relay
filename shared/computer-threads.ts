// A paired computer's own threads, which another computer lists and follows
// live, the ones it started itself too.
import type { AgentProvider } from "./agents";
import type { ChatActivitySection } from "./chat-activity";
import type { ChatScope, Project } from "./projects";

/** A thread on a paired computer, as that computer lists its own (`computerThreads`). */
export interface ComputerThread {
  /**
   * What another computer follows it by: its id there, or for a thread that
   * came from the computer asking, that handoff's id.
   */
  id: string;
  /** Its project, as the computer it's on knows it. */
  projectId: string;
  title: string;
  scope: ChatScope;
  updated: number;
  branch?: string;
  provider?: AgentProvider;
  running?: true;
  /** How long its turn has run, while it runs. */
  runningFor?: number;
  waiting?: true;
  asking?: true;
  blocked?: true;
  /** Where its Activity there has it: settled and snoozed ones wait apart. */
  section: ChatActivitySection;
}

/** A project whose threads a computer lists for the others: its own, still added, not scratch space. */
export const listsItsThreads = (
  project: Pick<Project, "scratch" | "computer" | "removed">,
) => !project.scratch && !project.computer && !project.removed;

/** A project of a paired computer's own, holding threads it lists. */
export interface ComputerThreadProject {
  id: string;
  name: string;
  /** Its folder there, from the home folder (`~/…`) when it's under it. */
  folder: string;
  plain?: true;
}

/** What a paired computer lists of its own threads, latest first. */
export interface ComputerThreadList {
  projects: ComputerThreadProject[];
  threads: ComputerThread[];
}

/** A thread on a paired computer that a thread here follows. */
export interface ComputerThreadHere {
  projectId: string;
  chatId: string;
  /** Only looked at from here, not written in: Threads doesn't list it. */
  peek?: true;
}

/** A paired computer's own threads, as the Computers sidebar lists them. */
export interface ComputerThreads {
  id: string;
  name: string;
  online: boolean;
  /** Why its threads can't be listed now. */
  problem?: string;
  projects: ComputerThreadProject[];
  threads: (ComputerThread & { here?: ComputerThreadHere })[];
}
