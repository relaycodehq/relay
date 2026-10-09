// Runs before the quick-switch store reads localStorage, which happens on import.
// The style sample only draws with presets; a fresh profile has none.
if (!JSON.parse(localStorage.getItem("relay-quick-switch") ?? "{}").presets?.length)
  localStorage.setItem(
    "relay-quick-switch",
    JSON.stringify({
      enabled: true,
      style: "revolver",
      sound: true,
      presets: [
        ["claude", "claude-opus-5-5", "high"],
        ["claude", "claude-sonnet-5", "medium"],
        ["codex", "gpt-6-astra", "high"],
        ["codex", "gpt-6-luna", "low"],
        ["opencode", "", ""],
        ["opencode", "", "medium"],
      ].map(([provider, model, reasoningEffort], i) => ({
        id: `sample-${i}`,
        provider,
        model,
        reasoningEffort,
        fast: false,
      })),
    }),
  );
