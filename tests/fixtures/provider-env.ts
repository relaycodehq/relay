import { delimiter, join, resolve } from "node:path";
import { agentProviders } from "../../shared/agents";

/** Provider homes are samples; inherited logins must not change a UI test. */
export function providerEnv(
  env: Record<string, string>,
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const data = env.RELAY_TEST_DATA;
  if (!data) throw new Error("A desktop test must set RELAY_TEST_DATA.");
  const result = { ...env };
  const defaults: Record<string, string> = {
    CODEX_HOME: join(data, "provider-homes", "codex"),
    CLAUDE_CONFIG_DIR: join(data, "provider-homes", "claude"),
    CLAUDE_SECURESTORAGE_CONFIG_DIR: join(data, "provider-homes", "claude"),
    OPENCODE_CONFIG_DIR: join(data, "provider-homes", "opencode"),
    XDG_CONFIG_HOME: join(data, "provider-homes", "config"),
    XDG_DATA_HOME: join(data, "provider-homes", "data"),
    XDG_STATE_HOME: join(data, "provider-homes", "state"),
    MISE_DATA_DIR: join(data, "provider-homes", "mise"),
    GEMINI_HOME: join(data, "provider-homes", "gemini"),
    AMP_SETTINGS_FILE: join(data, "provider-homes", "amp", "settings.json"),
  };
  for (const [key, fallback] of Object.entries(defaults))
    if (!result[key] || result[key] === inherited[key]) result[key] = fallback;
  for (const key of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
  ])
    if (result[key] === inherited[key]) delete result[key];

  const pathOf = (values: NodeJS.ProcessEnv) =>
    Object.entries(values).find(([key]) => key.toUpperCase() === "PATH")?.[1] ??
    "";
  const original = new Set(
    pathOf(inherited)
      .split(delimiter)
      .map((p) => resolve(p)),
  );
  const fixtureDirs = pathOf(result)
    .split(delimiter)
    .filter(Boolean)
    .map((p) => resolve(p))
    .filter((p) => !original.has(p));
  result.RELAY_TEST_PROVIDER_ROOTS = JSON.stringify([
    resolve(data),
    ...fixtureDirs,
  ]);
  result.RELAY_TEST_PROVIDER_COMMANDS = JSON.stringify([
    ...agentProviders,
    "amp-acp",
  ]);
  return result;
}
