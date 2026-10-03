// Adapted from T3 Code's apps/desktop/src/linuxSecretStorage.ts (MIT).

// Chromium matches XDG_CURRENT_DESKTOP case-sensitively, stops at the first name it
// recognises, and picks a real keyring only for these. KDE selects its own KWallet.
const PROTECTED = new Set([
  "Deepin",
  "GNOME",
  "KDE",
  "Pantheon",
  "UKUI",
  "Unity",
  "X-Cinnamon",
  "XFCE",
]);
// Recognised, but Chromium still stores basic text for it.
const UNPROTECTED = new Set(["LXQt"]);

/**
 * The --password-store Relay has to force so the login persists, or null when
 * Chromium already picks a keyring. Hyprland (Omarchy), Sway and Niri all need it;
 * without a running Secret Service, encryption stays unavailable and the login
 * stays in memory as before.
 */
export function linuxPasswordStore(
  env: NodeJS.ProcessEnv,
): "gnome-libsecret" | null {
  for (const name of env.XDG_CURRENT_DESKTOP?.split(":") ?? []) {
    const desktop = name.trim();
    if (PROTECTED.has(desktop)) return null;
    if (UNPROTECTED.has(desktop)) break;
  }
  return "gnome-libsecret";
}
