import type { AccountProvider } from "../../../shared/agent-accounts";

export const usagePage: Record<AccountProvider, string> = {
  claude: "https://claude.ai/settings/usage",
  codex: "https://chatgpt.com/settings/usage?tab=overview",
  antigravity: "https://antigravity.google.com/",
};
