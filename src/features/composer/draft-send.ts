import type { QueryClient } from "@tanstack/react-query";
import type { ChatSummary } from "../../../shared/projects";
import {
  draftRecipient,
  takesOver,
  threadContextAgent,
} from "../../../shared/recipient";
import { buildSend } from "../../../shared/compose-send";
import { codexQuestionChoice, supportedChoice } from "../../../shared/settings";
import { agentSwitchNoticeHidden } from "./agent-switch-notice";
import { api } from "../../lib/api";
import {
  composerProvider,
  loadComposerSettings,
  saveComposerSettings,
  startThreadSettings,
} from "../agents/composer-settings";
import {
  isPickAgent,
  livePick,
  messageChoice,
  messageContext,
} from "../agents/composer-models";
import {
  clearDraftAttachments,
  loadDraftAttachments,
  withAttachments,
} from "./draft-attachments";
import { loadDraftImages, saveDraftImages } from "../images/draft-images";
import {
  forgetNewThread,
  loadDraftScope,
  loadDraftWorkspace,
  readDraft,
  writeDraft,
  type ActivityDraft,
} from "./drafts";
import { numberImages } from "../../../shared/image-refs";
import { flattenSketch } from "../images/sketch";
import { aiSettingsQuery } from "../agents/useAISettings";
import { agentModelsQuery } from "../agents/useAgentPicks";
import { codexModels } from "../agents/useCodexModels";
import { newThreadAgentQuery } from "./useNewThreadAgent";

// A thread made for a draft whose message then failed takes the next try.
const started = new Map<string, ChatSummary>();

/**
 * Sends a thread's main draft the way its composer would, without opening
 * it: on the agent, models and modes last set there, with its screenshots
 * and attachments. Returns the thread it went to, or null when it needs its
 * thread open: a command, a review still to set up, or another agent taking over.
 */
export async function sendDraft(
  qc: QueryClient,
  { key, id, project, chat }: ActivityDraft,
): Promise<ChatSummary | null> {
  const text = readDraft(key).trim();
  const scope = chat?.scope ?? loadDraftScope(id);
  // Commands run in the composer; a review starts from its setup.
  if (!text || text.startsWith("/") || (scope.kind === "review" && !chat))
    return null;
  const ai = await qc.fetchQuery(aiSettingsQuery);
  const settings = loadComposerSettings(id);
  // A new thread's composer takes up the agent last picked for one.
  const lastAgent = chat
    ? undefined
    : await qc.fetchQuery(newThreadAgentQuery).catch(() => undefined);
  // The agent the thread's composer would warn about leaving.
  const holder = chat && threadContextAgent(chat);
  const provider = composerProvider(
    lastAgent || settings.provider,
    !!chat?.shared,
    holder ?? ai.threadProvider,
  );
  const recipient = draftRecipient(text, provider);
  if (takesOver(recipient, holder) && !agentSwitchNoticeHidden()) return null;
  const selected = supportedChoice(
    settings.models.codex?.choice ?? codexQuestionChoice(ai),
    await codexModels(qc),
  );
  const pick = isPickAgent(recipient)
    ? livePick(
        settings.models[recipient],
        await qc.fetchQuery(agentModelsQuery(recipient)).catch(() => []),
      )
    : { model: "", reasoningEffort: "" as const };
  const choice = messageChoice(recipient, settings.models, selected, pick);
  if (!choice) return null;
  const council =
    settings.ultraplan &&
    recipient !== "message" &&
    !chat?.shared &&
    scope.kind !== "review";
  const draftImages = await loadDraftImages(key);
  const outgoing = numberImages(text, draftImages);
  const images = await Promise.all(outgoing.images.map(flattenSketch));
  const value = buildSend(
    {
      to: recipient,
      choice,
      ...messageContext(recipient, settings.models),
      runtimeMode: settings.runtimeMode,
      interactionMode: settings.interactionMode,
    },
    outgoing.text,
    {
      ...(council ? { council: settings.council } : {}),
      ...(chat?.running ? { running: { steer: false } } : {}),
      images: images.map(({ name, mimeType, dataUrl }) => ({
        name,
        mimeType,
        dataUrl,
      })),
    },
  );
  const target =
    chat ??
    started.get(id) ??
    (await api.createProjectChat(
      project.id,
      scope,
      scope.kind === "project" ? loadDraftWorkspace(id, project) : undefined,
    ));
  started.set(id, target);
  const attachments = loadDraftAttachments(id);
  await api.sendProjectChat(target.id, {
    ...withAttachments(value, attachments),
    id: crypto.randomUUID(),
  });
  started.delete(id);
  // A council is one question's worth; its thread goes on with the lead.
  if (council) saveComposerSettings(id, { ...settings, ultraplan: false });
  if (!chat) {
    startThreadSettings(id, target.id, recipient);
    forgetNewThread(id);
  }
  // The draft may have been opened and written in while this went out: only
  // what went goes.
  const left = unsent(readDraft(key), text);
  if (left !== readDraft(key)) writeDraft(key, left);
  clearDraftAttachments(id, attachments);
  const sentImages = new Set(draftImages.map((image) => image.id));
  await loadDraftImages(key)
    .then((now) =>
      saveDraftImages(
        key,
        now.filter((image) => !sentImages.has(image.id)),
      ),
    )
    .catch(() => {});
  await qc.invalidateQueries({ queryKey: ["project-chats"] });
  if (chat) await qc.invalidateQueries({ queryKey: ["project-chat", chat.id] });
  return target;
}

/** The draft once `sent` went: what was typed after it stays, a rewrite stays whole. */
export function unsent(draft: string, sent: string) {
  const now = draft.trim();
  return now.startsWith(sent) ? now.slice(sent.length).trim() : draft;
}
