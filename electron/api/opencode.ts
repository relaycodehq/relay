import {
  openCodeAuthDirectory,
  openCodeAuthRequest,
} from "../../shared/opencode-auth";
import { openCodeAuth, openCodeAuthProviders } from "../agents/opencode/auth";
import { agentRuntime } from "../agents";
import { takes, type Handlers } from "./context";

/** OpenCode owns the provider credentials and OAuth attempts; Relay presents the flow. */
export function openCodeHandlers() {
  return {
    openCodeAuthProviders: takes([openCodeAuthDirectory], async (directory) => {
      const providers = await openCodeAuthProviders(directory);
      await agentRuntime("opencode").reloadModels?.(async () => {});
      return providers;
    }),
    openCodeAuth: takes([openCodeAuthRequest], async (input) => {
      const result = await openCodeAuth(input);
      if (
        (result.kind === "done" && input.kind !== "cancel") ||
        (result.kind === "status" && result.state.status === "complete")
      )
        await agentRuntime("opencode").reloadModels?.(async () => {});
      return result;
    }),
  } satisfies Handlers;
}
