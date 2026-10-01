import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { DevOpsSettings, WorkItem } from "../../../shared/devops";
import type { Project } from "../../../shared/projects";
import type { Fetch } from "./client";
import { RelevanceCache } from "./relevance-cache";
import { askSystemOne } from "./system-one";

/** Keeps each Jev request well inside its 64k-token budget. */
const batchSize = 80;

// Hashes of these objects key the saved answers, so their shape and key
// order are part of the cache file's format.
const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** What Jev knows about the Relay project. */
function projectState(project: Project, keywords: string) {
  return {
    project: {
      name: project.name,
      folder: basename(project.path),
      ...(project.repository
        ? {
            repository: `${project.repository.owner}/${project.repository.name}`,
          }
        : {}),
      ...(keywords ? { keywords } : {}),
    },
  };
}

/** The yes/no question Jev answers about one work item. */
function itemQuestion(w: WorkItem, keywords: string) {
  return {
    type: "noul",
    instructions: {
      work_item: {
        title: w.title,
        type: w.type,
        area_path: w.areaPath,
        team_project: w.project,
        ...(w.tags.length ? { tags: w.tags } : {}),
        ...(w.description ? { description: w.description.slice(0, 400) } : {}),
      },
      question: keywords
        ? "`work_item` is work on the software project in `project`: it matches the project's name, repository, folder or `project.keywords`."
        : "`work_item` is work on the software project in `project`: it matches the project's name, repository or folder.",
    },
    criteria: {
      true: "The work item is about this project's product, codebase or features.",
      false:
        "The work item is about a different product, app, device or component.",
    },
  };
}

/**
 * Asks the System One model one yes/no question per work item. Answers are
 * keyed on exactly what Jev sees, so comments, state changes and other
 * edits outside the prompt never ask again.
 */
export class RelevanceFilter {
  private cache: RelevanceCache;
  /** One run per cache key at a time, so overlaps never ask twice. */
  private running = new Map<string, Promise<Record<string, number>>>();

  constructor(
    private fetch: Fetch,
    private key: () => Promise<string | undefined>,
    cacheFile?: string,
  ) {
    this.cache = new RelevanceCache(cacheFile);
  }

  /** Each item's yes-probability, for the items Jev has answered. */
  async filter(
    settings: DevOpsSettings["filter"],
    project: Project,
    items: WorkItem[],
  ) {
    const key = await this.key();
    if (!key) throw new Error("Add an OpenRouter API key to use the filter.");
    const keywords = settings.keywords[project.id] ?? "";
    const state = projectState(project, keywords);
    const cacheKey = sha([settings.model, state]);
    const questions = new Map(
      items.map((w) => {
        const question = itemQuestion(w, keywords);
        return [w.id, { question, hash: sha(question) }];
      }),
    );
    const run = (this.running.get(cacheKey) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const cache = await this.cache.load();
        const entry = (cache[cacheKey] ??= { at: 0, answers: {} });
        entry.at = Date.now();
        const missing = items.filter(
          (w) => !(questions.get(w.id)!.hash in entry.answers),
        );
        try {
          for (let i = 0; i < missing.length; i += batchSize) {
            const batch = missing.slice(i, i + batchSize);
            const answers = await askSystemOne(
              this.fetch,
              key,
              settings.model,
              state,
              Object.fromEntries(
                batch.map((w) => [`wi_${w.id}`, questions.get(w.id)!.question]),
              ),
            );
            for (const w of batch) {
              const p = answers[`wi_${w.id}`];
              if (typeof p === "number")
                entry.answers[questions.get(w.id)!.hash] = p;
            }
          }
        } finally {
          // Keep only questions about items still assigned, answered or not.
          const current = new Set([...questions.values()].map((q) => q.hash));
          for (const hash of Object.keys(entry.answers))
            if (!current.has(hash)) delete entry.answers[hash];
          await this.cache.save(cache);
        }
        return entry.answers;
      });
    this.running.set(cacheKey, run);
    try {
      const answers = await run;
      return Object.fromEntries(
        items
          .filter((w) => questions.get(w.id)!.hash in answers)
          .map((w) => [w.id, answers[questions.get(w.id)!.hash]]),
      );
    } finally {
      if (this.running.get(cacheKey) === run) this.running.delete(cacheKey);
    }
  }
}
