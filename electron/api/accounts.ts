import { z } from "zod";
import {
  accountIdSchema,
  accountLabelSchema,
  accountProviderSchema,
} from "../../shared/agent-accounts";
import { idSchema } from "../../shared/rooms";
import { takes, type ApiContext, type Handlers } from "./context";

/** Claude Code and Codex accounts: Settings' list, and a thread's own pick. */
export function accountHandlers(ctx: ApiContext) {
  const { agentAccounts: accounts, projectChats } = ctx;
  return {
    agentAccounts: () => accounts.state(),
    addAgentAccount: takes(
      [accountProviderSchema, accountLabelSchema],
      (provider, label) => accounts.add(provider, label),
    ),
    signInAgentAccount: takes(
      [accountProviderSchema, accountIdSchema],
      (provider, id) => accounts.signInAgain(provider, id),
    ),
    cancelAgentAccountSignIn: async () => accounts.cancelSignIn(),
    renameAgentAccount: takes(
      [accountProviderSchema, accountIdSchema, accountLabelSchema],
      (provider, id, label) => accounts.rename(provider, id, label),
    ),
    removeAgentAccount: takes(
      [accountProviderSchema, accountIdSchema],
      (provider, id) => accounts.remove(provider, id),
    ),
    moveAgentAccount: takes(
      [accountProviderSchema, accountIdSchema, z.union([z.literal(-1), z.literal(1)])],
      (provider, id, by) => accounts.move(provider, id, by),
    ),
    useAgentAccount: takes(
      [accountProviderSchema, accountIdSchema],
      (provider, id) => accounts.use(provider, id),
    ),
    setThreadAccount: takes(
      [idSchema, accountProviderSchema, accountIdSchema],
      (chatId, provider, id) => projectChats.setAccount(chatId, provider, id),
    ),
  } satisfies Handlers;
}
