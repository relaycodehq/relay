// Adding a project beyond Finder's picker: a folder on disk, a clone, or a
// new one, as the add-project palette asks for them.
import { z } from "zod";

/** A repository the `gh` login can see, newest push first. */
export interface GithubRepo {
  /** owner/name */
  full: string;
  description: string;
  private: boolean;
  /** Last push, epoch ms. */
  pushed: number;
  url: string;
}

/** What `gh` says: the login and its repositories, or why it can't. */
export type GithubRepos =
  { login: string; repos: GithubRepo[] } | { problem: string };

/** A folder an agent in a terminal worked in lately that isn't a project. */
export interface RecentFolder {
  path: string;
  repository: boolean;
  /** Epoch ms of the newest session there. */
  when: number;
}

/** Where the palette opens: the folder clones go to, and recent folders. */
export interface AddingStart {
  cloneFolder: string;
  home: string;
  recent: RecentFolder[];
}

/** A clone or a new project under way, or null once it is over. */
export interface AddingJob {
  title: string;
  step: string;
  /** 0..1, or null while git hasn't said how far. */
  progress: number | null;
}

export const newProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[\w.-]+$/)
    .refine((n) => n !== "." && n !== ".." && !n.startsWith("-")),
  location: z.string().min(1).max(4096),
  git: z.boolean(),
  github: z.boolean(),
  private: z.boolean(),
});
export type NewProject = z.infer<typeof newProjectSchema>;

/** A clone URL from any host, or owner/repo for GitHub; null for anything else. */
export function parseRemote(text: string) {
  const t = text
    .trim()
    .replace(/^[a-z]+(?=:\/\/)/i, (scheme) => scheme.toLowerCase());
  const url =
    /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?|git@)([^/:]+)(?::\d+)?[/:]((?:[\w.-]+\/)*[\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      t,
    );
  if (url)
    return { host: url[1].toLowerCase(), full: `${url[2]}/${url[3]}`, url: t };
  const short = /^([\w-][\w.-]*)\/([\w.-]+?)(?:\.git)?$/.exec(t);
  if (short && !t.startsWith("."))
    return {
      host: "github.com",
      full: `${short[1]}/${short[2]}`,
      url: `https://github.com/${short[1]}/${short[2]}.git`,
    };
  return null;
}

/** The folder a clone of `full` goes into. */
export const repoName = (full: string) =>
  full
    .split("/")
    .pop()!
    .replace(/\.git$/, "");

/** A folder name from what was typed: lower-case words joined by dashes. */
export const slug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "");
