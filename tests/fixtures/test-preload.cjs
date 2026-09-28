// Runs before the app's own scripts in every test window.
// The UI tests were written before opening Changes, Files or History hid the
// projects sidebar, and click through it with panes open. Leave the sidebar
// be unless a test turns that on itself.
try {
  if (localStorage.getItem("relay-sidebar-auto-hide") === null)
    localStorage.setItem("relay-sidebar-auto-hide", "off");
} catch {
  // No storage on this page.
}
