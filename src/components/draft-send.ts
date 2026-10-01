import type { QueryClient } from "@tanstack/react-query";
import type { ChatSummary } from "../../shared/projects";
import { agentMention } from "../../shared/rooms";
import { buildSend } from "../../shared/compose-send";
import { codexQuestionChoice, supportedChoice } from "../../shared/settings";
import { api } from "../lib/api";
import {
  composerProvider,
  isPickAgent,
  livePick,
  loadComposerSettings,
  messageChoice,
  messageContext,
  saveComposerSettings,
  startThreadSettings,
} from "../lib/composer-settings";
import {
  clearDraftAttachments,
  loadDraftAttachments,
  withAttachments,
} from "../lib/draft-attachments";
import { loadDraftImages, saveDraftImages } from "../lib/draft-images";
import {
  forgetNewThread,
  loadDraftScope,
  loadDraftWorkspace,
  readDraft,
  writeDraft,
  type ActivityDraft,
} from "../lib/drafts";
import { flattenSketch } from "../lib/sketch";
import { aiSettingsQuery } from "../lib/useAISettings";
import { agentModelsQuery } from "../lib/useAgentPicks";
import { codexModels } from "../lib/useCodexModels";
import { newThreadAgentQuery } from "../lib/useNewThreadAgent";
import { agentSwitchNoticeHidden } from "./AgentSwitchDialog";

// A thread made for a draft whose message then failed takes the next try.
const started = new Map<string, ChatSummary>();

/**
 * Sends a thread's main draft the way its composer would, without opening
 * it: on the agent, models and modes last set there, with its screenshots
 * and attachments. False when it needs its thread open: a command, a review
 * still to set up, or another agent taking over.
 */
export async function sendDraft(
  qc: QueryClient,
  { key, id, project, chat }: ActivityDraft,
): Promise<boolean> {
  const text = readDraft(key).trim();
  const scope = chat?.scope ?? loadDraftScope(id);
  // Commands run in the composer; a review starts from its setup.
  if (!text || text.startsWith("/") || (scope.kind === "review" && !chat))
    return false;
  const ai = await qc.fetchQuery(aiSettingsQuery);
  const settings = loadComposerSettings(id);
  // A new thread's composer takes up the agent last picked for one.
  const lastAgent = chat
    ? undefined
    : await qc.fetchQuery(newThreadAgentQuery).catch(() => undefined);
  const provider = composerProvider(
    lastAgent || settings.provider,
    !!chat?.shared,
    chat?.provider ?? ai.threadProvider,
  );
  const mention = agentMention(text);
  const recipient = mention?.provider ?? provider;
  if (
    chat?.provider &&
    recipient !== "message" &&
    recipient !== chat.provider &&
    !agentSwitchNoticeHidden()
  )
    return false;
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
  if (!choice) return false;
  const council =
    settings.ultraplan &&
    recipient !== "message" &&
    !chat?.shared &&
    scope.kind !== "review";
  const images = await Promise.all(
    (await loadDraftImages(key)).map(flattenSketch),
  );
  const value = buildSend(
    {
      to: recipient,
      choice,
      ...messageContext(recipient, settings.claude),
      runtimeMode: settings.runtimeMode,
      interactionMode: settings.interactionMode,
    },
    text,
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
      scope.kind === "project" ? loadDraftWorkspace(id) : undefined,
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
  return true;
}
