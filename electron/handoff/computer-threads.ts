// The paired computers' own threads: what each lists, so the Computers
// sidebar can show them beside the ones that went there from here.
import { z } from "zod";
import {
  liveAway,
  type ChatSentTo,
  type PairedComputer,
  type StartedThere,
} from "../../shared/handoff";
import { RENDER_MAX_CHARS } from "../../shared/html-render";
import type {
  ComputerThread,
  ComputerThreadHere,
  ComputerThreadList,
  ComputerThreads as ListedThreads,
} from "../../shared/computer-threads";
import { errorMessage } from "../../shared/error-message";
import {
  computerThreadsBridge,
  newThreadsBridge,
  projectSessionsBridge,
} from "../../shared/remote";
import type {
  ChatSummary,
  ChatTriage,
  Project,
  ProjectChatSend,
  StartedBy,
} from "../../shared/projects";
import type { TerminalSessionPick } from "../../shared/terminal-sessions";
import type { Store } from "../app/store";
import { listed, summaryOf } from "./away";
import type { ProjectChats } from "../project-chats";
import type { Projects } from "../projects/projects";
import type { ComputerInfos } from "./computer-infos";
import type { Computers } from "./computers";
import type { HandoffFollowing } from "./following";

/** A thread a lead's agent started on the computer the lead runs on. */
interface StartedUnder {
  /** The lead as this computer has it. */
  lead: ChatSummary;
  thread: StartedThere;
}

const startedByOf = ({ lead, thread }: StartedUnder): StartedBy => ({
  chatId: lead.id,
  agent: thread.agent,
});

export class ComputerThreads {
  /** Threads being opened, so a second click waits for the first. */
  private opening = new Map<string, Promise<ComputerThreadHere>>();
  /** Each lead's latest pass over the threads its agent started. */
  private startedPasses = new Map<string, Promise<void>>();

  constructor(
    private store: Store,
    private computers: Computers,
    private infos: ComputerInfos,
    private projects: Projects,
    private chats: ProjectChats,
    private following: HandoffFollowing,
  ) {}

  /** Every paired computer's threads, as each lists them now. */
  list(): Promise<ListedThreads[]> {
    return Promise.all(this.computers.list().map((c) => this.listOn(c)));
  }

  private async listOn(computer: PairedComputer): Promise<ListedThreads> {
    const { id, name } = computer;
    // A WSL distribution asleep isn't woken just to list it.
    const online = computer.status === "online" && !computer.asleep;
    const none = { id, name, online, projects: [], threads: [] };
    if (!online) return none;
    try {
      const client = await this.computers.connected(id);
      const info = await this.infos.get(id, client);
      if (!info || info.bridge < computerThreadsBridge)
        return {
          ...none,
          problem: `Update Relay on ${name} to see its threads here.`,
        };
      const { projects, threads } = await client.call("computerThreads");
      const here = this.followedFrom(id);
      return {
        ...none,
        projects,
        threads: threads.map((t) => {
          const chat = here.get(t.id);
          return chat ? { ...t, here: chat } : t;
        }),
      };
    } catch (e) {
      return { ...none, problem: errorMessage(e) };
    }
  }

  /**
   * The thread here that follows one on the computer, made the first time:
   * in its project there, added here as one that lives there, and kept as
   * a mirror that runs there, as a thread started in that project from here.
   * Opened from the list it's a peek; one a lead's agent started there sits
   * under that lead instead (`under`).
   */
  open(
    computerId: string,
    threadId: string,
    under?: StartedUnder,
    list?: () => Promise<ComputerThreadList>,
  ) {
    const key = `${computerId}:${threadId}`;
    let job = this.opening.get(key);
    if (!job) {
      job = this.follow(computerId, threadId, under, list).finally(() =>
        this.opening.delete(key),
      );
      this.opening.set(key, job);
    }
    return job;
  }

  /**
   * The threads a lead's agent started on the computer it runs on, followed
   * from here under that lead, so Activity shows them beneath it as it does
   * the ones started here; and let go of once that computer stops naming
   * them. A peek's lead isn't listed, so neither are they. One pass per lead
   * at a time, so an older list never lands after a newer one.
   */
  followStarted(computerId: string, leadId: string, started: StartedThere[]) {
    const pass = (this.startedPasses.get(leadId) ?? Promise.resolve())
      .then(() => this.followStartedNow(computerId, leadId, started))
      .catch((e) =>
        console.warn(
          "Threads started on another computer weren't followed:",
          e,
        ),
      );
    this.startedPasses.set(leadId, pass);
    void pass.finally(() => {
      if (this.startedPasses.get(leadId) === pass)
        this.startedPasses.delete(leadId);
    });
    return pass;
  }

  private async followStartedNow(
    computerId: string,
    leadId: string,
    started: StartedThere[],
  ) {
    const lead = listed(this.store, leadId);
    if (!lead || lead.sentTo?.peek) return;
    await this.letGoOfUnnamed(computerId, lead, started);
    const here = this.followedFrom(computerId);
    const unplaced = started.filter((thread) => {
      const followed = here.get(thread.id);
      const placed =
        !!followed && !!listed(this.store, followed.chatId)?.startedBy;
      // A settled one is followed once it wakes.
      return !placed && !thread.settled;
    });
    if (!unplaced.length) return;
    // Asked for by id, as the computer's list leaves older ones out.
    let listing: Promise<ComputerThreadList> | undefined;
    const list = () =>
      (listing ??= this.threadsOn(
        computerId,
        unplaced.map((t) => t.id),
      ));
    for (const thread of unplaced)
      await this.followUnder(computerId, { lead, thread }, list).catch((e) =>
        console.warn(
          "A thread started on another computer wasn't followed:",
          e,
        ),
      );
  }

  /**
   * The threads here under the lead that its computer no longer names:
   * detached, archived or gone there. Only that computer's own: one handed
   * there from here keeps its lead.
   */
  private async letGoOfUnnamed(
    computerId: string,
    lead: ChatSummary,
    started: StartedThere[],
  ) {
    const named = new Set(started.map((t) => t.id));
    const unnamed = (this.store.get().chats ?? []).filter(
      (c) =>
        c.startedBy?.chatId === lead.id &&
        c.sentTo?.home &&
        c.sentTo.computerId === computerId &&
        liveAway(c) &&
        !named.has(c.sentTo.id),
    );
    for (const c of unnamed) await this.chats.liveHandoff.started.letGo(c.id);
  }

  /**
   * Follows one, or places the one already followed under its lead: it may
   * have been opened from the computer's list first, as a peek.
   */
  private async followUnder(
    computerId: string,
    under: StartedUnder,
    list: () => Promise<ComputerThreadList>,
  ) {
    const mirror = await this.open(computerId, under.thread.id, under, list);
    await this.chats.liveHandoff.started.placeUnder(
      mirror.chatId,
      startedByOf(under),
    );
  }

  /** The computer's threads, or with `ids` just those. */
  private async threadsOn(computerId: string, ids?: string[]) {
    const client = await this.computers.connected(computerId);
    return ids
      ? client.call("computerThreads", ids)
      : client.call("computerThreads");
  }

  private async follow(
    computerId: string,
    threadId: string,
    under: StartedUnder | undefined,
    list = () => this.threadsOn(computerId),
  ): Promise<ComputerThreadHere> {
    const known = this.followedFrom(computerId).get(threadId);
    if (known) return known;
    const { name } = this.computers.get(computerId);
    const threads = await list();
    const thread = threads.threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`That thread isn't on ${name} anymore.`);
    const projectId = await this.projectFor(computerId, threads, thread, under);
    const peek = !under;
    const chat = await this.chats.liveHandoff.followThere(
      projectId,
      thread,
      {
        id: thread.id,
        computerId,
        computer: name,
        at: Date.now(),
        state: "away",
        live: true,
        kept: 0,
        folder: true,
        home: true,
        ...(peek ? { peek: true as const } : {}),
      },
      under && startedByOf(under),
    );
    await this.following.follow(computerId, chat.id);
    return { projectId, chatId: chat.id, ...(peek ? { peek } : {}) };
  }

  /**
   * The project here a thread on the computer goes in: its lead's, when the
   * thread works in the lead's project there, or else its project there,
   * added here as one that lives there.
   */
  private async projectFor(
    computerId: string,
    { projects }: ComputerThreadList,
    thread: ComputerThread,
    under: StartedUnder | undefined,
  ) {
    if (under?.thread.inLeadsProject) return under.lead.projectId;
    const there = projects.find((p) => p.id === thread.projectId);
    const { name } = this.computers.get(computerId);
    if (!there) throw new Error(`That thread isn't on ${name} anymore.`);
    const project = await this.projects.addRemote(
      { id: computerId, name },
      {
        id: there.id,
        name: there.name,
        path: there.folder,
        plain: there.plain,
      },
    );
    return project.id;
  }

  /**
   * A new thread of a project that lives on the computer: made there as one
   * of its own, by this thread's id, and followed from here like any other
   * of its threads, before `first` goes there as its first message.
   */
  async startThere(chatId: string, first: ProjectChatSend) {
    const chat = summaryOf(this.store, chatId);
    const home = this.projects.get(chat.projectId).computer;
    if (!home) throw new Error("This project isn't on another computer.");
    const { name } = this.computers.get(home.id);
    const client = await this.computers.connected(home.id);
    const info = await this.infos.get(home.id, client, true);
    if (!info || info.bridge < newThreadsBridge)
      throw new Error(`Update Relay on ${name} to start threads there.`);
    const there = await client.call(
      "newThreadInProject",
      home.projectId,
      chatId,
    );
    await this.chats.liveHandoff.followNew(
      chatId,
      {
        id: there.chatId,
        computerId: home.id,
        computer: name,
        at: Date.now(),
        state: "away",
        live: true,
        kept: 0,
        folder: true,
        home: true,
      },
      first,
    );
    // Followed before its first message goes, so what that writes comes here.
    await this.following.follow(home.id, chatId);
  }

  /**
   * Resumes a saved session of a project that lives on the computer, there,
   * and opens the thread that carries it on. It was asked for, so it shows in
   * Threads at once rather than as a peek.
   */
  async resume(project: Project, pick: TerminalSessionPick) {
    const { id: computerId, projectId } = project.computer!;
    const { name } = this.computers.get(computerId);
    const client = await this.computers.connected(computerId);
    const info = await this.infos.get(computerId, client, true);
    if (!info || info.bridge < projectSessionsBridge)
      throw new Error(`Update Relay on ${name} to resume its sessions here.`);
    const there = await client.call("resumeInProject", projectId, pick);
    const here = await this.open(computerId, there.chatId);
    const sentTo = summaryOf(this.store, here.chatId).sentTo;
    if (sentTo?.peek) {
      await this.chats.handoffs.updateSentTo(here.chatId, sentTo.id, {
        peek: undefined,
      });
      // Followed as a peek, the threads its agent started were passed over.
      void this.following.follow(computerId, here.chatId);
    }
    return { chat: summaryOf(this.store, here.chatId), created: there.created };
  }

  /** A page one of the thread's answers showed there, no bigger than a page may be. */
  async renderPage(sentTo: ChatSentTo, renderId: string, page: number) {
    const client = await this.computers.connected(sentTo.computerId);
    const html = await client.call("threadRender", sentTo.id, renderId, page);
    return z.string().max(RENDER_MAX_CHARS).parse(html);
  }

  /** Settles, snoozes or wakes one of the computer's own threads there. */
  async triage(computerId: string, threadId: string, triage: ChatTriage) {
    const client = await this.computers.connected(computerId);
    await client.call("threadTriage", threadId, triage);
  }

  /** The threads here that follow one on the computer, by what they follow it by. */
  private followedFrom(computerId: string) {
    const here = new Map<string, ComputerThreadHere>();
    for (const c of this.store.get().chats ?? [])
      if (c.sentTo?.computerId === computerId && liveAway(c))
        here.set(c.sentTo.id, {
          projectId: c.projectId,
          chatId: c.id,
          ...(c.sentTo.peek ? { peek: true as const } : {}),
        });
    return here;
  }
}
