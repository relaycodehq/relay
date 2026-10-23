import type { RuntimeMode } from "../../shared/agent-modes";
import type { AgentProvider } from "../../shared/agents";
import {
  sameModel,
  sentModel,
  type NewThreadModel,
} from "../../shared/new-thread-models";
import type { ProjectChatSend } from "../../shared/projects";
import type { Store } from "../app/store";

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

export async function saveNewThreadRuntimeMode(
  store: Store,
  mode: RuntimeMode,
) {
  if (store.get().newThreadRuntimeMode === mode) return;
  await store.update((s) => {
    s.newThreadRuntimeMode = mode;
  });
}

/** A message sent to an agent, here or from the phone, makes its model and access the next new thread's. */
export async function rememberSent(store: Store, send: ProjectChatSend) {
  const sent = sentModel(send);
  if (!sent) return;
  await saveNewThreadModel(store, ...sent).catch(() => {});
  await saveNewThreadRuntimeMode(store, send.runtimeMode).catch(() => {});
}
