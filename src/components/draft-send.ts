import type { QueryClient } from "@tanstack/react-query";
import type { ChatSummary, ProjectChatSend } from "../../shared/projects";
import { agentMention } from "../../shared/rooms";
import { workItemMessage } from "../../shared/devops";
import { codeReferenceMessage } from "../../shared/code-references";
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
  loadCodeRefs,
  loadSelection,
  loadWorkItem,
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
  const images = await Promise.all(
    (await loadDraftImages(key)).map(flattenSketch),
  );
  const body =
    mention || recipient === "message" ? text : `@${recipient} ${text}`;
  const value: Omit<ProjectChatSend, "id"> = {
    ...(chat?.running ? { delivery: "queue" as const } : {}),
    body,
    choice,
    ...messageContext(recipient, settings.claude),
    provider: recipient === "message" ? "codex" : recipient,
    runtimeMode: settings.runtimeMode,
    interactionMode: council ? "plan" : settings.interactionMode,
    ...(council ? { ultraplan: settings.council } : {}),
    ...(images.length
      ? {
          images: images.map(({ name, mimeType, dataUrl }) => ({
            name,
            mimeType,
            dataUrl,
          })),
        }
      : {}),
  };
  const target =
    chat ??
    started.get(id) ??
    (await api.createProjectChat(
      project.id,
      scope,
      scope.kind === "project" ? loadDraftWorkspace(id) : undefined,
    ));
  started.set(id, target);
  const workItem = loadWorkItem(id);
  const selection = loadSelection(id);
  await api.sendProjectChat(target.id, {
    ...value,
    id: crypto.randomUUID(),
    body: codeReferenceMessage(
      loadCodeRefs(id),
      workItem ? workItemMessage(workItem, body) : body,
    ),
    ...(selection ? { selection: { ...selection, question: body } } : {}),
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
