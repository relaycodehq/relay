import type { AgentProvider } from "../shared/agents";
import {
  sameModel,
  sentModel,
  type NewThreadModel,
} from "../shared/new-thread-models";
import type { ProjectChatSend } from "../shared/projects";
import type { Store } from "./store";

export async function saveNewThreadModel(
  store: Store,
  provider: AgentProvider,
  model: NewThreadModel,
) {
  if (sameModel(store.get().newThreadModels?.[provider], model)) return;
  await store.update((s) => {
    s.newThreadModels = { ...s.newThreadModels, [provider]: model };
  });
}

/** A message sent to an agent, here or from the phone, makes its model the next new thread's. */
export async function rememberSentModel(store: Store, send: ProjectChatSend) {
  const sent = sentModel(send);
  if (sent) await saveNewThreadModel(store, ...sent).catch(() => {});
}
