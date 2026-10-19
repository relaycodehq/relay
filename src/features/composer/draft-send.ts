import type { QueryClient } from "@tanstack/react-query";
import {
  lastComposerSettings,
  type ChatSummary,
} from "../../../shared/projects";
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
  startThreadSettings,
  withSent,
  saveComposerSettings,
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
  loadDraftLinks,
  loadDraftScope,
  draftWorktreeBranch,
  loadDraftWorkspace,
  markDraftSent,
  readDraft,
  writeDraft,
  type ActivityDraft,
} from "./drafts";
import { attachedImages, numberImages } from "../../../shared/image-refs";
import { unsent } from "../../../shared/drafts";
import { startsWithCommand } from "../../../shared/commands";
import { flattenSketch } from "../images/sketch";
import { draftChips } from "../../lib/thread-storage";
import { pickedSkills } from "../../../shared/skill-mentions";
import { aiSettingsQuery } from "../agents/useAISettings";
import { agentModelsQuery } from "../agents/useAgentPicks";
import { codexModels } from "../agents/useCodexModels";
import { newThreadAgentQuery } from "./useNewThreadAgent";
import { fetchChat } from "../../lib/chat-events";

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
  const draftImages = await loadDraftImages(key);
  const scope = chat?.scope ?? loadDraftScope(id);
  // Commands run in the composer; a review starts from its setup.
  if (
    (!text && !attachedImages(text, draftImages).length) ||
    startsWithCommand(text) ||
    (scope.kind === "review" && !chat)
  )
    return null;
  const ai = await qc.query(aiSettingsQuery);
  const local = loadComposerSettings(id);
  const settings = withSent(
    local,
    chat ? lastComposerSettings(await fetchChat(qc, chat.id)) : undefined,
  );
  if (settings !== local) saveComposerSettings(id, settings);
  // A new thread's composer takes up the agent last picked for one, unless
  // its draft has frozen.
  const lastAgent =
    chat || settings.frozen
      ? undefined
      : await qc.query(newThreadAgentQuery).catch(() => undefined);
  // The agent the thread's composer would warn about leaving.
  const holder = chat && threadContextAgent(chat);
  const provider = composerProvider(
    lastAgent || settings.provider,
    holder ?? ai.threadProvider,
  );
  const recipient = draftRecipient(text, provider);
  if (takesOver(recipient, holder) && !agentSwitchNoticeHidden()) return null;
  // A message to the thread alone needs words.
  if (recipient === "message" && !text) return null;
  // A project on another computer runs that computer's agents.
  const home = project.computer;
  const selected = supportedChoice(
    settings.models.codex?.choice ?? codexQuestionChoice(ai),
    await codexModels(qc, home?.id),
  );
  const pick = isPickAgent(recipient)
    ? livePick(
        settings.models[recipient],
        await qc.query(agentModelsQuery(recipient, home?.id)).catch(() => []),
      )
    : { model: "", reasoningEffort: "" as const };
  const choice = messageChoice(recipient, settings.models, selected, pick);
  if (!choice) return null;
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
      ...(chat?.running ? { running: { steer: false } } : {}),
      skills: pickedSkills(outgoing.text, draftChips(key).skills.load()),
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
      scope.kind === "project" ? draftWorktreeBranch(id, project) : undefined,
      loadDraftLinks(id),
    ));
  started.set(id, target);
  const attachments = loadDraftAttachments(id);
  const messageId = crypto.randomUUID();
  const input = { ...withAttachments(value, attachments), id: messageId };
  // Its first message starts it there; later ones follow it there.
  if (home && !chat) await api.startProjectChatOn(target.id, input, home.id);
  else await api.sendProjectChat(target.id, input);
  // A background send has no mounted composer to acknowledge its own input.
  if (recipient !== "message" && !value.delivery)
    saveComposerSettings(id, {
      ...loadComposerSettings(id),
      sent: messageId,
    });
  started.delete(id);
  if (!chat) {
    startThreadSettings(id, target.id, recipient);
    forgetNewThread(id);
  }
  // The draft may have been opened and written in while this went out: only
  // what went goes.
  if (chat) markDraftSent(chat.id);
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

export { unsent };
