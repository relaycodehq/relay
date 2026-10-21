// Importing another app's history with an agent: the thread opened for it,
// what its agent reads and offers (import_sources, offer_import), and the
// import the user runs from that offer. The import itself is ProjectImports'.
import { randomUUID } from "node:crypto";
import {
  freshChats,
  ghostKey,
  type ImportOffer,
  type ImportOfferProject,
  type RunImportOffer,
} from "../../shared/import-offer";
import {
  importAppNames,
  type ImportApp,
  type ImportChat,
  type ProjectImportResult,
} from "../../shared/project-import";
import type { RelayToolArgs } from "../relay-mcp";
import type { ChatCore } from "./core";
import type { ProjectImports } from "./project-import";
import { assertHere } from "./handoff";
import { chatSummary } from "./storage";

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export class ImportOffers {
  constructor(
    private core: ChatCore,
    private imports: ProjectImports,
  ) {}

  /** Marks a new thread as opened to import `app`'s history, before its first turn. */
  async open(id: string, app: ImportApp) {
    const chat = await this.core.storage.load(id);
    await this.core.store.update((s) => {
      s.chats!.find((c) => c.id === id)!.importFrom = app;
    });
    chat.importFrom = app;
    this.core.storage.summariesChanged(chat.projectId);
    return chatSummary(chat);
  }

  /** import_sources: a line a project, or one project's chats; short, so a big history stays cheap. */
  async sources(app: ImportApp, key?: string) {
    const projects = await this.imports.list(app);
    if (key) {
      const source = projects.find((p) => p.key === key);
      if (!source)
        throw new Error(`There is no project ${key}; list them first.`);
      const chats = await this.imports.chats(app, key);
      return [
        `${source.name} (${source.path}): ${chats.length} chats, newest first`,
        ...chats.map(
          (c) =>
            `${c.id}  ${day(c.updated)}  ${c.turns} turns  ${c.title.replace(/\s+/g, " ").slice(0, 100)}${c.chatId ? "  [in Relay]" : ""}`,
        ),
      ].join("\n");
    }
    const lines = await Promise.all(
      projects.map(async (p) => {
        const chats = p.missing ? [] : await this.imports.chats(app, p.key);
        const fresh = chats.filter((c) => !c.chatId);
        const newest = chats.reduce((t, c) => Math.max(t, c.updated), 0);
        return `${p.key}  ${p.name}  ${p.path}  ${fresh.length} new of ${chats.length} chats${newest ? `, newest ${day(newest)}` : ""}${p.projectId ? "  [project in Relay]" : ""}${p.missing ? "  [folder missing]" : ""}`;
      }),
    );
    return lines.length
      ? `${importAppNames[app]} on this computer, key first:\n${lines.join("\n")}`
      : `${importAppNames[app]} has no projects on this computer.`;
  }

  /** offer_import: the offer, built from what the source has now, left under the agent's answer. */
  async offer(
    chatId: string,
    app: ImportApp,
    input: RelayToolArgs<"offer_import">,
  ) {
    const active = this.core.active.get(chatId);
    if (!active?.importOffer || this.core.active.windingDown(active))
      throw new Error("This thread has no running answer to offer it in.");
    const sources = new Map(
      (await this.imports.list(app)).map((p) => [p.key, p]),
    );
    const projects: ImportOfferProject[] = [];
    const unknown: string[] = [];
    for (const asked of input.projects) {
      const source = sources.get(asked.key);
      if (
        !source ||
        source.missing ||
        projects.some((p) => p.key === asked.key)
      ) {
        if (!source || source.missing) unknown.push(asked.key);
        continue;
      }
      const chats: ImportChat[] = await this.imports.chats(app, source.key);
      const known = new Set(chats.filter((c) => !c.chatId).map((c) => c.id));
      projects.push({
        key: source.key,
        name: source.name,
        path: source.path,
        ...(source.projectId ? { projectId: source.projectId } : {}),
        group:
          asked.group
            ?.split("/")
            .map((g) => g.trim())
            .filter(Boolean)
            .join("/") ?? "",
        chats,
        picked: asked.chats
          ? asked.chats.filter((id) => known.has(id))
          : [...known],
      });
    }
    if (!projects.length)
      throw new Error(
        `None of those keys is a project ${importAppNames[app]} has here; use the keys import_sources gives.`,
      );
    active.importOffer({ id: randomUUID(), app, projects });
    const chats = projects.reduce((n, p) => n + p.picked.length, 0);
    return `The list is in your answer: ${projects.length} projects, ${chats} chats ticked.${unknown.length ? ` Left out, not found: ${unknown.join(", ")}.` : ""} The user imports from it.`;
  }

  /** Imports what the user ticked in an offer, then puts the new projects where they left them. */
  run(id: string, messageId: string, input: RunImportOffer) {
    return this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      const chat = await this.core.storage.load(id);
      assertHere(chat);
      const message = chat.messages.find((m) => m.id === messageId);
      const offer = message?.importOffer;
      if (!message || !offer)
        throw new Error("This import is no longer available.");
      if (offer.done) throw new Error("This list was already imported.");
      const byKey = new Map(offer.projects.map((p) => [p.key, p]));
      const selections = Object.entries(input.picks).flatMap(([key, chats]) => {
        const p = byKey.get(key);
        if (!p) return [];
        const offered = new Set(freshChats(p).map((c) => c.id));
        return [{ key, chats: chats.filter((c) => offered.has(c)) }];
      });
      if (!selections.length) throw new Error("Tick something to import.");
      const result = await this.imports.run(offer.app, selections);
      await this.place(offer, input, result);
      offer.done = {
        at: Date.now(),
        imported: Object.fromEntries(
          result.projects.map((p) => [
            p.key,
            p.chats.flatMap((c) =>
              c.chat.fromTerminal ? [c.chat.fromTerminal.session] : [],
            ),
          ]),
        ),
        failures: result.failures,
      };
      message.version++;
      await this.core.storage.save(chat);
      this.core.emit({ chatId: id, message: structuredClone(message) });
      return result;
    });
  }

  /** Last first, so the project each sits above is already where it goes. */
  private async place(
    offer: ImportOffer,
    input: RunImportOffer,
    result: ProjectImportResult,
  ) {
    const made = new Map(
      result.projects
        .filter((p) => !offer.projects.find((o) => o.key === p.key)?.projectId)
        .map((p) => [p.key, p.project.id]),
    );
    const placements = input.placements.filter((p) => made.has(p.key));
    for (const placement of [...placements].reverse()) {
      const below = placement.before && ghostKey(placement.before);
      const before = below ? (made.get(below) ?? null) : placement.before;
      await this.core.projects.move(
        made.get(placement.key)!,
        placement.group,
        before,
      );
    }
    // Any the user's layout didn't place go to the end of their group, in the offer's order.
    for (const { key, group } of offer.projects)
      if (made.has(key) && !placements.some((p) => p.key === key))
        await this.core.projects.move(made.get(key)!, group, null);
  }
}
