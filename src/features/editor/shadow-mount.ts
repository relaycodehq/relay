/**
 * Where a view goes: a shadow root of `host`, so Relay's stylesheet, whose
 * thousands of rules every element of the page is matched against, never
 * reaches the editor's lines. CodeMirror brings its own styles in there; CSS
 * variables still come through from the page.
 */
export function shadowMount(host: HTMLElement) {
  return host.shadowRoot ?? host.attachShadow({ mode: "open" });
}
