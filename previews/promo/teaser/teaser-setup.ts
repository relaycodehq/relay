// The film is shot in Relay's own dark theme. appearance.ts reads the saved
// choice when it loads, so this runs first and puts the previews' own saved
// settings back once the teaser has read them.
const key = "preview-settings-file";
const saved = localStorage.getItem(key);
localStorage.setItem(key, JSON.stringify({ appearance: { mode: "dark" } }));
export function restoreSavedAppearance() {
  if (saved === null) localStorage.removeItem(key);
  else localStorage.setItem(key, saved);
}
