import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { net } from "electron";
import { z } from "zod";
import { applyChatPatch, knownOf } from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import { idSchema } from "../../shared/validation";
import { seal, unseal } from "../app/login";
import type { Store } from "../app/store";
import { GuestShares, type GuestSharesHost } from "../guest-share";
import { Funnel } from "../guest-share/funnel";
import { importGuestThread } from "../guest-share/import";
import { lastSend } from "../started-threads/lead-side";
import { takes, type ApiContext, type Handlers } from "./context";

/** Where the guest server listens first; a worktree's Relay moves it with its other ports. */
const GUEST_PORT = 47410 + (Number(process.env.RELAY_PORT_OFFSET) || 0);

/** Test runs keep their links on this computer: a real Tailscale would publish them. */
const testFunnel = () =>
  new Funnel(
    Object.assign(async () => ({ ok: false, stdout: "", output: "" }), {
      sync: () => {},
    }),
  );

/** Share with guest: a thread a browser outside Relay can follow and suggest messages to. */
export function guestShareHandlers(ctx: ApiContext) {
  const chats = ctx.projectChats;
  const shares = new GuestShares(sharesHost(ctx));
  return {
    guestShare: takes([idSchema], (id) => shares.share(id)),
    startGuestShare: takes([idSchema], (id) => shares.start(id)),
    stopGuestShare: takes([idSchema], (id) => shares.stop(id)),
    guestSuggestions: takes([idSchema], (id) => shares.waiting(id)),
    sendGuestSuggestion: takes([idSchema], (id) => shares.send(id)),
    resolveGuestSuggestion: takes(
      [idSchema, z.enum(["drafted", "dismissed"])],
      (id, status) => shares.resolve(id, status),
    ),
    importGuestThread: takes(
      [idSchema, z.string().max(4096)],
      (projectId, link) =>
        importGuestThread(
          {
            fetch: (url, init) => net.fetch(String(url), init),
            create: (project, shared) =>
              chats.creating.importShared(project, shared),
            filesDir: (threadId) =>
              join(ctx.store.dir, "shared-threads", threadId),
          },
          projectId,
          link,
        ),
    ),
  } satisfies Handlers;
}

/** What the shares read and do in the rest of Relay. */
function sharesHost(ctx: ApiContext): GuestSharesHost {
  const chats = ctx.projectChats;
  return {
    // Only the messages that changed since the last read are copied again.
    thread: async (id, previous) =>
      applyChatPatch(
        await chats.changes(id, knownOf(previous) ?? {}),
        previous,
      ),
    summary: (id) => ctx.store.get().chats?.find((c) => c.id === id),
    // Read with every update a guest gets, so a cleaned-up review folder isn't made again.
    root: (thread) =>
      chats.worktrees
        .terminalFolder(thread.projectId, thread.id, false)
        .catch(() => null),
    media: {
      image: (chatId, imageId) => chats.files.image(chatId, imageId),
      readImage: (chatId, messageId, path) =>
        chats.files.readImage(chatId, messageId, path, false),
      previewShot: (chatId, messageId) =>
        chats.files.previewShot(chatId, messageId),
      turnVideoPath: (chatId, messageId, path) =>
        chats.files.turnVideoPath(chatId, messageId, path, false),
    },
    renderPage: (threadId, renderId, page) =>
      chats.renderPage(threadId, renderId, page),
    onSummaries: (listener) => chats.onSummaries(listener),
    send: (event) => ctx.window.send("relay:guest-share", event),
    async sendAsGuest(threadId, name, text) {
      // On what the thread last ran, as a message from another thread would.
      const previous = lastSend(await chats.get(threadId));
      const agent = sentAgent(previous);
      // The host sends it, so it unsettles a thread set to settle as one of theirs would.
      await chats.sendYours(threadId, {
        id: randomUUID(),
        body: text,
        choice: previous.choice,
        ...(previous.contextWindow
          ? { contextWindow: previous.contextWindow }
          : {}),
        provider: agent,
        to: agent,
        runtimeMode: previous.runtimeMode,
        interactionMode: previous.interactionMode,
        guest: { name },
      });
    },
    saved: {
      load: () => ctx.store.get().guestShares ?? [],
      save: (shares) =>
        ctx.store.update((s) => {
          s.guestShares = shares;
        }),
    },
    key: signingKey(ctx.store),
    port: GUEST_PORT,
    ...(process.env.RELAY_TEST_DATA ? { funnel: testFunnel() } : {}),
  };
}

/**
 * The key guest links are signed with: made once, sealed by the OS
 * credential store, or kept `plain:` where there is none, as the phone
 * bridge's key is.
 */
function signingKey(store: Store) {
  let key: Promise<Buffer> | undefined;
  const load = async () => {
    const saved = store.get().guestShareKey;
    if (saved) {
      const value = saved.startsWith("plain:")
        ? saved.slice(6)
        : await unseal(saved);
      return Buffer.from(value, "base64");
    }
    const made = randomBytes(32).toString("base64");
    const sealed = (await seal(made)) ?? `plain:${made}`;
    await store.update((s) => {
      s.guestShareKey = sealed;
    });
    return Buffer.from(made, "base64");
  };
  // A refused Keychain prompt isn't kept: the next share asks again.
  return () =>
    (key ??= load().catch((e) => {
      key = undefined;
      throw e;
    }));
}
