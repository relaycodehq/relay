import type { QueryClient } from "@tanstack/react-query";
import type { ChatSummary } from "../../../shared/projects";
import { draftRecipient, threadContextAgent } from "../../../shared/recipient";
import { buildSend } from "../../../shared/compose-send";
import { codexQuestionChoice, supportedChoice } from "../../../shared/settings";
import { agentSwitchNoticeHidden } from "./agent-switch-notice";
import { api } from "../../lib/api";
import {
  composerProvider,
  isPickAgent,
  livePick,
  loadComposerSettings,
  messageChoice,
  messageContext,
  saveComposerSettings,
  startThreadSettings,
} from "../agents/composer-settings";
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
  if (
    holder &&
    recipient !== "message" &&
    recipient !== holder &&
    !agentSwitchNoticeHidden()
  )
    return null;
  const selected = supportedChoice(
    settings.choice ?? codexQuestionChoice(ai),
    await codexModels(qc),
  );
  const pick = isPickAgent(recipient)
    ? livePick(
        settings.picks[recipient],
        await qc.fetchQuery(agentModelsQuery(recipient)).catch(() => []),
      )
    : { model: "", reasoningEffort: "" as const };
  const choice = messageChoice(recipient, selected, settings.claude, pick);
  if (!choice) return null;
  const council =
    settings.ultraplan &&
    recipient !== "message" &&
    !chat?.shared &&
    scope.kind !== "review";
  const outgoing = numberImages(text, await loadDraftImages(key));
  const images = await Promise.all(outgoing.images.map(flattenSketch));
  const value = buildSend(
    {
      to: recipient,
      choice,
      ...messageContext(recipient, settings.claude),
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
  await api.sendProjectChat(target.id, {
    ...withAttachments(value, loadDraftAttachments(id)),
    id: crypto.randomUUID(),
  });
  started.delete(id);
  // A council is one question's worth; its thread goes on with the lead.
  if (council) saveComposerSettings(id, { ...settings, ultraplan: false });
  if (!chat) {
    startThreadSettings(id, target.id, recipient);
    forgetNewThread(id);
  }
  writeDraft(key, "");
  clearDraftAttachments(id);
  await saveDraftImages(key, []).catch(() => {});
  await qc.invalidateQueries({ queryKey: ["project-chats"] });
  if (chat) await qc.invalidateQueries({ queryKey: ["project-chat", chat.id] });
  return target;
}
