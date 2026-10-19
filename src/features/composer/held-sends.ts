// A phone's send of a draft this computer holds part of: the phone sends its
// text and settings, and this page adds what only it has (screenshots, code
// references, a selected line, a new thread's scope and branch), then sends.
// It runs in the main window's page, or in a hidden one the main process
// opens while Relay sits in the menubar alone.
import { api } from "../../lib/api";
import { threadDraftKey } from "../../lib/thread-storage";
import { numberImages } from "../../../shared/image-refs";
import { draftThread, newDraftProject, type HeldSend, type HeldSendResult } from "../../../shared/drafts";
import type { ProjectChatSend } from "../../../shared/projects";
import { flattenSketch } from "../images/sketch";
import {
  loadDraftImages,
  saveDraftImages,
} from "../images/draft-images";
import {
  clearDraftAttachments,
  loadDraftAttachments,
  withAttachments,
} from "./draft-attachments";
import {
  draftWorktreeBranch,
  draftWorktreeStart,
  forgetNewThread,
  loadDraftLinks,
  loadDraftScope,
  loadDraftWorkspace,
} from "./drafts";
import { quietly } from "./draft-sync";

/** Answers the phones' sends the main process hands this page, and those it held while none was open. */
export function followHeldSends() {
  if (!api.onDraftSend) return;
  const taken = new Set<string>();
  const take = (request: HeldSend) => {
    if (taken.has(request.id)) return;
    taken.add(request.id);
    void sendHeld(request)
      .catch((e): HeldSendResult => ({
        error: e instanceof Error ? e.message : String(e),
      }))
      .then((result) => api.finishDraftSend(request.id, result))
      .catch((e) => console.warn("Couldn't report a phone's draft send:", e));
  };
  const stop = api.onDraftSend(take);
  void api
    .waitingDraftSends()
    .then((waiting) => waiting.forEach(take))
    .catch(() => {});
  return stop;
}

async function sendHeld({ key, chatId, send }: HeldSend): Promise<HeldSendResult> {
  const composer = threadDraftKey(key);
  const thread = draftThread(key)?.chatId ?? key;
  const reply = !!draftThread(key)?.root;
  const own = await loadDraftImages(composer).catch(() => []);
  // The phone's photos go after this computer's screenshots, which its tokens name.
  const outgoing = numberImages(send.body, [
    ...own,
    ...(send.images ?? []).map((image) => ({ ...image, n: undefined })),
  ]);
  const images = await Promise.all(
    outgoing.images.map((image) =>
      "sketch" in image ? flattenSketch(image) : image,
    ),
  );
  const attachments = reply ? undefined : loadDraftAttachments(thread);
  const base: ProjectChatSend = {
    ...send,
    body: outgoing.text,
    images: images.map(({ name, mimeType, dataUrl }) => ({ name, mimeType, dataUrl })),
  };
  const value = attachments
    ? { ...withAttachments(base, attachments), id: send.id }
    : base;
  let target = chatId;
  if (!target) {
    const projectId = newDraftProject(key);
    const project = (await api.projects()).find((p) => p.id === projectId);
    if (!project) throw new Error("That project isn't in Relay anymore.");
    const scope = loadDraftScope(key);
    // A review starts from its setup, not from a message.
    if (scope.kind === "review")
      throw new Error("Start that review on the computer.");
    const made = await api.createProjectChat(
      project.id,
      scope,
      scope.kind === "project" ? loadDraftWorkspace(key, project) : undefined,
      scope.kind === "project" ? draftWorktreeBranch(key, project) : undefined,
      loadDraftLinks(key),
      scope.kind === "project" ? draftWorktreeStart(key, project) : undefined,
    );
    target = made.id;
  }
  await api.sendProjectChat(target, value);
  // What went goes; the computer drops the draft itself once this answers.
  const sent = new Set(
    outgoing.images.flatMap((image) => ("id" in image ? [image.id] : [])),
  );
  await quietly(async () => {
    if (attachments) clearDraftAttachments(thread, attachments);
    await saveDraftImages(
      composer,
      own.filter((image) => !sent.has(image.id)),
    ).catch(() => {});
    if (!chatId) forgetNewThread(key);
  });
  return { chatId: target };
}
