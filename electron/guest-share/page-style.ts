/** The guest page's look: Relay's colours, light or dark as the guest's system is. */
export const GUEST_STYLE = `
:root { color-scheme: light dark; --bg: #fbfbfc; --fg: #303237; --muted: #898b93; --line: #e2e3e6; --card: #fff; --soft: #f4f4f6; --accent: #6565a9; --accent-fg: #fff; --code: #f6f6f8; }
@media (prefers-color-scheme: dark) { :root { --bg: #18181b; --fg: #e7e7ea; --muted: #94949f; --line: #2e2e33; --card: #1f1f23; --soft: #26262b; --accent: #a3a3e6; --accent-fg: #18181b; --code: #232328; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
a { color: var(--accent); }
button { font: inherit; cursor: pointer; color: var(--fg); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; }
button.primary { color: var(--accent-fg); background: var(--accent); border-color: transparent; font-weight: 500; }
button:disabled { opacity: .5; cursor: default; }
header.top { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.top-inner { max-width: 820px; margin: 0 auto; padding: 12px 20px; display: flex; gap: 12px; align-items: center; }
.top-title { flex: 1; min-width: 0; }
.top-title h1 { margin: 0; font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-title p { margin: 0; font-size: 12px; color: var(--muted); }
.top a.continue { font-size: 13px; text-decoration: none; padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--fg); white-space: nowrap; }
main { max-width: 820px; margin: 0 auto; padding: 20px 20px 240px; }
ol.messages { list-style: none; margin: 0; padding: 0; display: grid; gap: 22px; }
.msg { content-visibility: auto; contain-intrinsic-size: auto 160px; }
.msg-from { font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 4px; }
.msg.user .msg-body { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; }
.msg-body > :first-child { margin-top: 0; } .msg-body > :last-child { margin-bottom: 0; }
.msg-body p { margin: 0 0 10px; }
.msg-body pre { background: var(--code); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; overflow-x: auto; font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace; }
.msg-body code { font: .9em ui-monospace, "SF Mono", Menlo, monospace; background: var(--soft); padding: 1px 4px; border-radius: 4px; }
.msg-body pre code { background: none; padding: 0; }
.msg-body blockquote { margin: 0 0 10px; padding-left: 12px; border-left: 3px solid var(--line); color: var(--muted); }
.msg-body .table { overflow-x: auto; } .msg-body table { border-collapse: collapse; font-size: 14px; margin-bottom: 10px; }
.msg-body th, .msg-body td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; }
.msg-body img, .msg-body video, .shots img { max-width: 100%; border-radius: 8px; border: 1px solid var(--line); display: block; margin: 6px 0; }
.local-link { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .9em; color: var(--muted); }
.msg.streaming .msg-body::after { content: "▍"; color: var(--muted); }
details.calls { margin: 0 0 8px; font-size: 13px; color: var(--muted); }
details.calls summary { cursor: pointer; list-style: none; } details.calls summary::-webkit-details-marker { display: none; }
details.calls summary::before { content: "▸ "; } details.calls[open] summary::before { content: "▾ "; }
.call { margin: 4px 0 0 14px; }
.call-line { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.call-line.open { cursor: pointer; color: var(--fg); }
.call-line .kind { color: var(--muted); margin-right: 6px; }
.call.failed .call-line { color: #d9646c; }
.call pre { max-height: 320px; overflow: auto; background: var(--code); border: 1px solid var(--line); border-radius: 6px; padding: 8px; font: 12px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--fg); }
.render { margin: 8px 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--card); }
.render-head { display: flex; gap: 6px; align-items: center; padding: 6px 10px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); }
.render-head span { flex: 1; } .render-head button { padding: 2px 8px; font-size: 12px; } .render-head button.on { border-color: var(--accent); color: var(--accent); }
.render iframe { display: block; width: 100%; border: 0; height: 300px; }
.shots p { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
#working { color: var(--muted); font-size: 13px; margin-top: 14px; }
section.files { margin-top: 32px; } section.files h2, section.yours h2 { font-size: 13px; color: var(--muted); font-weight: 500; margin: 0 0 8px; }
section.files ul, section.yours ul { list-style: none; margin: 0; padding: 0; }
section.files li button { width: 100%; display: flex; justify-content: space-between; gap: 12px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: none; padding: 7px 2px; text-align: left; font: 13px ui-monospace, "SF Mono", Menlo, monospace; }
section.files li button span:last-child { color: var(--muted); font-family: inherit; flex: none; }
section.yours { margin-top: 28px; } section.yours li { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; border-bottom: 1px solid var(--line); padding: 6px 0; }
section.yours li span:first-child { white-space: pre-wrap; overflow-wrap: anywhere; } section.yours li span:last-child { color: var(--muted); flex: none; }
form.suggest { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; background: var(--bg); border-top: 1px solid var(--line); padding: 12px max(20px, calc((100vw - 780px) / 2)); display: grid; gap: 8px; }
form.suggest input, form.suggest textarea { width: 100%; font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; resize: vertical; }
form.suggest input:focus, form.suggest textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
#status { color: var(--muted); font-size: 13px; }
dialog.viewer { width: min(1000px, 94vw); height: min(86vh, 900px); padding: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--fg); }
dialog.viewer::backdrop { background: #0006; }
.viewer-head { display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line); font: 13px ui-monospace, "SF Mono", Menlo, monospace; }
.viewer-head span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.viewer-body { height: calc(100% - 46px); overflow: auto; }
.viewer-body ol { margin: 0; padding: 10px 0; list-style: none; counter-reset: line; font: 12.5px/1.55 ui-monospace, "SF Mono", Menlo, monospace; }
.viewer-body li { counter-increment: line; white-space: pre-wrap; overflow-wrap: anywhere; padding: 0 14px 0 64px; position: relative; }
.viewer-body li::before { content: counter(line); position: absolute; left: 0; width: 48px; text-align: right; color: var(--muted); }
#ended { text-align: center; color: var(--muted); margin-top: 30vh; }
`;
