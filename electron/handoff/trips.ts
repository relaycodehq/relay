import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "../../shared/error-message";
import { needsFullBundle, type HandoffThread } from "../../shared/handoff";
import {
  folderHandoffBridge,
  pastesBridge,
  remoteProjectsBridge,
  startHandoffBridge,
  type HomeThread,
} from "../../shared/remote";
import { Unanswered } from "../../shared/remote-client";
import type { Store } from "../app/store";
import {
  bundleBranch,
  fetchBundle,
  hasCommit,
  landReturned,
  repositoryNames,
} from "../git/bundles";
import { git } from "../git/git";
import type { ProjectChats } from "../project-chats";
import { portableMessages } from "../project-chats/handoff";
import type { Projects } from "../projects/projects";
import { named, onHandoff, seconds, summaryOf } from "./away";
import { outdated, type ComputerInfos } from "./computer-infos";
import { computerName, type Computers } from "./computers";
import type { HandoffFollowing } from "./following";
import type { HandoffNotices } from "./notices";
import { sendPastes } from "./pastes";
import type { RemoteStatuses } from "./remote-statuses";
import type { HandoffSetups } from "./setups";
import { nameOf } from "./targets";
import {
  download,
  readReturned,
  receivePastesFrom,
  settingsOf,
  upload,
} from "./transfer";

/**
 * A thread's way to the other computer and back: stopped, noted and
 * committed here, its messages and code across, and its work landed here
 * again on the way back. Each failure is left on the thread's `sentTo`.
 */
export class HandoffTrips {
  constructor(
    private store: Store,
    private computers: Computers,
    private chats: ProjectChats,
    private projects: Projects,
    private infos: ComputerInfos,
    /** Scratch space for bundles on their way, a folder per handoff. */
    private dir: string,
    private setups: HandoffSetups,
    private following: HandoffFollowing,
    private statuses: RemoteStatuses,
    private notices: HandoffNotices,
  ) {}

  /** Stop, note and commit here, then the thread and its code across. */
  async send(chatId: string, id: string, computerId: string) {
    if (summaryOf(this.store, chatId).sentTo?.home)
      return this.sendHome(chatId, id, computerId);
    const folder = join(this.dir, id);
    const started = Date.now();
    const still = () => onHandoff(this.store, chatId, id);
    try {
      if (!still()) return;
      const { name } = this.computers.get(computerId);
      const client = await this.computers.connected(computerId);
      const info = await this.infos.get(computerId, client, true);
      if (outdated(info))
        throw new Error(
          `${name} runs an older Relay. Update it from Settings → Computers, then try again.`,
        );
      const repositories = await repositoryNames(
        await this.projects.root(summaryOf(this.store, chatId).projectId),
      );
      if (!repositories.length)
        throw new Error(
          `This project has no Git remote, so ${name} can't find its copy.`,
        );
      // Until the project is there, the thread stays as it is here, its
      // agent stopped: what the user says now goes to the setup's agent.
      // A later look at that setup has nothing to stop, and checked in the
      // same tick as the stop, a thread started here instead keeps its turn.
      if (!still()) return;
      if (!summaryOf(this.store, chatId).sentTo?.setup)
        await this.chats.handoffs.halt(chatId);
      if (!still()) return;
      const ready = await this.setups.readied(
        chatId,
        id,
        computerId,
        client,
        info!.bridge,
        repositories,
      );
      if (!ready || !still()) return;
      const { chat, root, tip } = await this.chats.handoffs.leave(chatId, name);
      if (!still()) return;
      const worktree = chat.worktree!;
      const input = chat.lastInput;
      if (!input)
        throw new Error("Send a message before handing the thread off.");
      // Nothing answered it here: its first message starts it there.
      const start =
        !chat.messages.some((m) => m.role === "assistant") &&
        info!.bridge >= startHandoffBridge;
      const thread: HandoffThread = {
        from: computerName(),
        repositories,
        title: chat.title,
        scope: chat.scope,
        settings: settingsOf(input),
        messages: await sendPastes(
          portableMessages(chat.messages),
          client,
          info!.bridge >= pastesBridge,
        ),
        git: {
          branch: worktree.branch!,
          tip,
          bundle: false,
          ...(worktree.from ? { from: worktree.from } : {}),
          ...(worktree.start ? { start: worktree.start } : {}),
        },
        ...(start ? { start: true as const } : {}),
      };
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const bundle = join(folder, "bundle");
      const across = async (full: boolean) => {
        await rm(bundle, { force: true });
        thread.git.bundle =
          (await bundleBranch(root, thread.git.branch, bundle, { full })) !==
          false;
        const json = join(folder, "thread");
        await writeFile(json, JSON.stringify(thread), { mode: 0o600 });
        await upload(client, id, "thread", json);
        if (thread.git.bundle) await upload(client, id, "bundle", bundle);
        await client.call("receiveHandoff", id);
      };
      try {
        await across(false);
      } catch (e) {
        // The other side lacks what the lean bundle builds on.
        if (errorMessage(e) !== needsFullBundle) throw e;
        await across(true);
      }
      await this.chats.handoffs.updateSentTo(chatId, id, {
        state: "away",
        error: undefined,
        live: true,
        // A start's first message comes back from there as its own.
        kept: start ? 0 : chat.messages.length,
        ...(start ? { start: true as const } : {}),
        ...(info!.bridge >= folderHandoffBridge ? { folder: true } : {}),
      });
      await rm(folder, { recursive: true, force: true });
      console.info(
        `Handoff ${named(id, name)}: sent in ${seconds(started)}${thread.git.bundle ? "" : ", no bundle needed"}.`,
      );
      void this.following.follow(computerId, chatId);
    } catch (e) {
      console.warn(
        `Handoff ${named(id, nameOf(this.computers, computerId))} didn't go out:`,
        errorMessage(e),
      );
      // A look at a setup that didn't get through keeps the thread in it:
      // the computer coming back looks again.
      const lost =
        e instanceof Unanswered ||
        this.computers.status(computerId) !== "online";
      if (lost && summaryOf(this.store, chatId).sentTo?.setup) return;
      await this.chats.handoffs.updateSentTo(chatId, id, {
        error: errorMessage(e),
      });
    }
  }

  /** The other side stops, notes and commits; its work comes back into this worktree. */
  async back(chatId: string, id: string, computerId: string, park: boolean) {
    const folder = join(this.dir, id);
    const ref = `refs/relay/handoffs/${id}`;
    const started = Date.now();
    try {
      const path = summaryOf(this.store, chatId).worktree?.path;
      if (!path)
        throw new Error("The thread's worktree is gone on this computer.");
      const client = await this.computers.connected(computerId);
      const back = await client.call("handBack", id);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const json = join(folder, "thread");
      await download(client, id, "thread", back.thread, json);
      const messages = await receivePastesFrom(
        this.infos,
        computerId,
        client,
        readReturned(
          await readFile(json, "utf8"),
          this.computers.get(computerId).name,
        ),
      );
      if (back.bundle) {
        const bundle = join(folder, "bundle");
        await download(client, id, "bundle", back.bundle, bundle);
        if ((await fetchBundle(path, bundle, back.branch, ref)) !== back.tip)
          throw new Error("The bundle doesn't hold the returned commit.");
      } else if (!(await hasCommit(path, back.tip)))
        throw new Error("The returned commit is missing here.");
      if (!park) {
        const computer = this.computers.get(computerId).name;
        const conflicts = await landReturned(path, back.tip, computer).catch(
          (e) => {
            throw new Error(
              `Its work couldn't land in the worktree (${errorMessage(e)}). It's kept at ${ref}.`,
            );
          },
        );
        if (conflicts.length) {
          console.warn(
            `Handoff ${named(id, computer)}: came back clashing in ${conflicts.length} file(s), kept at ${ref}.`,
          );
          await this.chats.handoffs.updateSentTo(chatId, id, {
            error: `Its work and what was committed here meanwhile both change ${conflicts.join(", ")}. It's kept at ${ref}.`,
            conflicts,
          });
          return;
        }
        await git(path, ["update-ref", "-d", ref]).catch(() => {});
      }
      await this.chats.handoffs.returned(chatId, id, messages);
      console.info(
        `Handoff ${named(id, nameOf(this.computers, computerId))}: back in ${seconds(started)}${park ? ", parked" : ""}.`,
      );
      this.statuses.forget(id);
      await rm(folder, { recursive: true, force: true });
      await this.notices.acknowledge(computerId, id);
    } catch (e) {
      console.warn(
        `Handoff ${named(id, nameOf(this.computers, computerId))} didn't come back:`,
        errorMessage(e),
      );
      await this.chats.handoffs.updateSentTo(chatId, id, {
        error: errorMessage(e),
      });
    }
  }

  /**
   * A thread of a project that lives on the computer: nothing here to stop,
   * note or commit, so its first message just starts it in the project's
   * folder there, and it's followed live from then on.
   */
  private async sendHome(chatId: string, id: string, computerId: string) {
    const started = Date.now();
    let asked = false;
    try {
      if (!onHandoff(this.store, chatId, id)) return;
      const { name } = this.computers.get(computerId);
      const client = await this.computers.connected(computerId);
      const info = await this.infos.get(computerId, client, true);
      if (!info || info.bridge < remoteProjectsBridge)
        throw new Error(
          `${name} runs an older Relay. Update it from Settings → Computers, then try again.`,
        );
      const chat = await this.chats.get(chatId);
      const project = this.projects.get(chat.projectId).computer;
      if (!project) throw new Error("This project isn't on another computer.");
      const input = chat.lastInput;
      if (!input) throw new Error("Send a first message to start the thread.");
      const thread: HomeThread = {
        from: computerName(),
        title: chat.title,
        scope: chat.scope,
        settings: settingsOf(input),
        messages: await sendPastes(
          portableMessages(chat.messages),
          client,
          true,
        ),
      };
      asked = true;
      await client.call("startInProject", id, project.projectId, thread);
      if (!onHandoff(this.store, chatId, id)) return;
      await this.chats.handoffs.updateSentTo(chatId, id, {
        state: "away",
        error: undefined,
        live: true,
        // Its first message comes back from there as its own.
        kept: 0,
        start: true,
        folder: true,
      });
      console.info(
        `Thread ${named(id, name)}: started there in ${seconds(started)}.`,
      );
      void this.following.follow(computerId, chatId);
    } catch (e) {
      console.warn(
        `Thread ${named(id, nameOf(this.computers, computerId))} didn't start there:`,
        errorMessage(e),
      );
      // Refused there, or never asked: it isn't there, and trying again the
      // same way would fail the same way, so the thread is new again. An
      // answer lost on the way may have started it, so that one waits to retry.
      if (
        !asked ||
        (!(e instanceof Unanswered) &&
          this.computers.status(computerId) === "online")
      ) {
        await this.chats.handoffs.startRefused(chatId, id);
        throw e;
      }
      await this.chats.handoffs.updateSentTo(chatId, id, {
        error: errorMessage(e),
      });
    }
  }
}
