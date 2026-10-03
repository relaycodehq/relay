// The film is shot in Relay's own dark theme. appearance.ts reads the saved
// choice when it loads, so this runs first and puts the previews' own saved
// choice back once the teaser has read it.
const key = "relay-appearance";
const saved = localStorage.getItem(key);
localStorage.setItem(
  key,
  JSON.stringify({
    mode: "dark",
    light: { theme: "relay" },
    dark: { theme: "relay" },
  }),
);
export function restoreSavedAppearance() {
  if (saved === null) localStorage.removeItem(key);
  else localStorage.setItem(key, saved);
}
