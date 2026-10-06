/**
 * Desktop names Chromium knows in XDG_CURRENT_DESKTOP, matched case-sensitively,
 * and whether it then keeps secrets in a real keyring (KDE's being KWallet).
 * LXQt is known but still gets basic text.
 */
const chromiumKeyring = new Map<string, boolean>([
  ["GNOME", true],
  ["Unity", true],
  ["X-Cinnamon", true],
  ["Pantheon", true],
  ["Deepin", true],
  ["UKUI", true],
  ["XFCE", true],
  ["KDE", true],
  ["LXQt", false],
]);

/**
 * The --password-store Relay has to force so the login persists, or null when
 * Chromium already picks a keyring. Hyprland (Omarchy), Sway and Niri all need it;
 * without a running Secret Service, encryption stays unavailable and the login
 * stays in memory as before.
 */
export function linuxPasswordStore(
  env: NodeJS.ProcessEnv,
): "gnome-libsecret" | null {
  // Chromium settles on the first name in the list it recognises.
  const known = (env.XDG_CURRENT_DESKTOP ?? "")
    .split(":")
    .map((name) => name.trim())
    .find((name) => chromiumKeyring.has(name));
  return known !== undefined && chromiumKeyring.get(known)
    ? null
    : "gnome-libsecret";
}
