/**
 * The guest page's look: Relay's own thread, light or dark as the guest's
 * system is. Colours, sizes and spacing are the app's (src/styles.css, the
 * thread's and the composer's CSS); change them there first.
 */
export const GUEST_STYLE = `
:root { color-scheme: light; --surface: #fff; --toolbar: #f9f9fa; --inbox: #f7f7f8; --text: #303237; --muted: #676972; --border: #e2e3e6; --hover: #e5e5e9; --accent: #6565a9; --accent-soft: #eeeef7; --accent-foreground: #fff; --send: #aaa8e5; --send-foreground: #1b1b22; --danger: #e46b73; --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --surface: #1e1e21; --toolbar: #242427; --inbox: #28282c; --text: #e1e1e5; --muted: #94949f; --border: #37373d; --hover: #34343c; --accent: #aaa8e5; --accent-soft: #32313f; --accent-foreground: #22222a; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { background: var(--surface); }
body { margin: 0; background: var(--surface); color: var(--text); font: 13px/1.5 var(--font-sans); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
a { color: var(--accent); }
/* Line icons; an agent's mark keeps its own fill. */
:not(.glyph) > svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
button, .button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; font: inherit; font-size: 12px; line-height: 1.25; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 7px; padding: 7px 11px; white-space: nowrap; cursor: pointer; text-decoration: none; transition: background-color .1s; }
button:hover, .button:hover { background: var(--hover); }
button:disabled { opacity: .5; cursor: default; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.column { width: 100%; max-width: 1040px; margin: 0 auto; }

header.titlebar { position: sticky; top: 0; z-index: 5; height: 52px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(12px); }
.titlebar-inner { height: 100%; display: flex; align-items: center; gap: 8px; padding: 0 28px; }
.crumb, .crumb-sep { color: var(--muted); font-size: 13px; flex: none; }
.titlebar h1 { flex: 1; min-width: 0; margin: 0; font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

main { padding: 12px 28px 260px; }
ol.messages { list-style: none; margin: 0; padding: 0; }
.message { padding: 22px 0; overflow-wrap: anywhere; content-visibility: auto; contain-intrinsic-block-size: auto 300px; }
.message > header { display: flex; align-items: center; gap: 10px; font-size: 11px; margin-bottom: 10px; }
.message > header strong { display: inline-flex; align-items: center; gap: 6px; }
.message.assistant > header strong { color: var(--accent); }
.message time { font-size: 10px; color: var(--muted); }
.glyph { display: inline-flex; }
.glyph svg { width: 14px; height: 14px; }

.markdown { font-size: 14px; line-height: 1.75; }
.message.user .body { padding: 12px 16px; border: 1px solid var(--border); border-radius: 13px; background: var(--toolbar); font-size: 13px; line-height: 1.65; }
.message.user .markdown { font-size: inherit; line-height: inherit; }
/* A message of only pictures, or only a mention, has no box. */
.message.user .body:has(> .markdown:empty) { display: none; }
.markdown > :first-child { margin-top: 0; } .markdown > :last-child { margin-bottom: 0; }
.markdown p { margin: 8px 0; }
.markdown h1, .markdown h2, .markdown h3 { font-size: 15px; margin: 14px 0 8px; }
.markdown ul, .markdown ol { padding-left: 20px; margin: 8px 0; }
.markdown ul { list-style: disc; }
.markdown li > p { margin: 0; }
.markdown li::marker { color: var(--muted); }
.markdown code { font: 11px var(--font-mono); background: var(--inbox); padding: 2px 4px; border-radius: 4px; }
.markdown pre { overflow: auto; padding: 12px; margin: 10px 0; background: var(--inbox); border: 1px solid var(--border); border-radius: 6px; }
.markdown pre code { background: none; padding: 0; line-height: 1.6; }
.markdown blockquote { border-left: 3px solid var(--border); padding: 2px 14px; color: var(--muted); margin: 10px 0; }
.markdown .table { width: fit-content; max-width: 100%; overflow-x: auto; margin: 10px 0; border: 1px solid var(--border); border-radius: 6px; }
.markdown table { border-collapse: collapse; }
.markdown th, .markdown td { min-width: 110px; max-width: 360px; padding: 6px 10px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); }
.markdown th + th, .markdown td + td { border-left: 1px solid var(--border); }
.markdown tr:last-child td { border-bottom: 0; }
.markdown th { font-weight: 600; background: var(--toolbar); }
.markdown img, .markdown video { display: block; max-width: 100%; max-height: 420px; margin: 6px 0; border: 1px solid color-mix(in srgb, var(--text) 24%, transparent); border-radius: 9px; cursor: zoom-in; }
.markdown video { cursor: auto; }
.local-link { font-family: var(--font-mono); font-size: .9em; color: var(--muted); }
.message.streaming .markdown > :last-child::after { content: ""; display: inline-block; width: 7px; height: 7px; margin-left: 6px; border-radius: 50%; background: var(--accent); vertical-align: middle; animation: pulse 1s steps(20) infinite; }
@keyframes pulse { 50% { opacity: .3; } }

.message-images { display: flex; flex-wrap: wrap; gap: 8px; }
.message.user > .message-images { margin: 0 0 9px; }
.message.assistant > .message-images { margin-top: 9px; }
.message-image { width: 94px; height: 74px; padding: 0; border: 1px solid color-mix(in srgb, var(--text) 24%, transparent); border-radius: 9px; overflow: hidden; background: var(--hover); cursor: zoom-in; }
.message-image img { width: 100%; height: 100%; object-fit: cover; display: block; }

details.agent-activity { font-size: 12px; color: var(--muted); margin: 0 0 12px; }
details.agent-activity > summary { list-style: none; display: inline-flex; align-items: center; gap: 7px; min-height: 24px; cursor: pointer; font-variant-numeric: tabular-nums; }
details.agent-activity > summary::-webkit-details-marker { display: none; }
details.agent-activity > summary:hover { color: var(--text); }
details.agent-activity > summary svg { width: 13px; height: 13px; transition: transform .12s ease; }
details.agent-activity[open] > summary .chevron { transform: rotate(90deg); }
.calls { position: relative; margin: 6px 0 0 6px; padding-left: 15px; border-left: 1px solid var(--border); }
.call { padding: 2px 0; }
.call-line { display: flex; gap: 8px; min-width: 0; font-size: 12px; }
.call-line .kind { flex: none; width: 48px; color: var(--muted); }
.call-line .label { min-width: 0; font-family: var(--font-mono); font-size: 11.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.call-line.open { cursor: pointer; }
.call-line.open:hover .label { text-decoration: underline; text-underline-offset: 2px; }
.call.failed .label { color: var(--danger); }
.call pre { max-height: 320px; overflow: auto; margin: 6px 0 8px; padding: 10px 12px; background: var(--inbox); border-radius: 6px; font: 11.5px/1.55 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); }

.render { margin: 10px 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface); }
.render-head { display: flex; gap: 6px; align-items: center; padding: 6px 10px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--border); }
.render-head span { flex: 1; }
.render-head button { padding: 3px 8px; font-size: 11px; }
.render-head button.on { background: var(--accent-soft); border-color: transparent; color: var(--accent); }
.render iframe { display: block; width: 100%; border: 0; height: 300px; }

#working { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; margin: 4px 0 0; }
.working-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: pulse 1s steps(20) infinite; }
section.files, section.yours { margin-top: 28px; }
section h2 { font-size: 11px; font-weight: 600; color: var(--muted); margin: 0 0 6px; }
section ul { list-style: none; margin: 0; padding: 0; }
section.files li button { width: 100%; justify-content: space-between; gap: 12px; border: 0; border-radius: 6px; background: none; padding: 6px 8px; margin: 0 -8px; text-align: left; font: 11.5px var(--font-mono); }
section.files li button:hover { background: var(--hover); }
section.files li button span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
section.files li button span:last-child { color: var(--muted); font: 11px var(--font-sans); flex: none; }
section.yours li { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--border); }
section.yours li span:first-child { white-space: pre-wrap; overflow-wrap: anywhere; }
section.yours li span:last-child { color: var(--muted); flex: none; }

.dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; padding: 28px 28px 24px; pointer-events: none; background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--surface) 80%, transparent) 36px, var(--surface) 72px); }
form.composer { pointer-events: auto; border: 1px solid var(--border); border-radius: 20px; background: var(--toolbar); box-shadow: 0 5px 18px #00000006; overflow: hidden; }
form.composer textarea { display: block; width: 100%; min-height: 72px; max-height: 240px; padding: 18px 20px 9px; border: 0; background: transparent; color: var(--text); font: 13px/1.65 var(--font-sans); resize: none; outline: none; field-sizing: content; }
form.composer textarea::placeholder, form.composer input::placeholder { color: var(--muted); }
.composer-tools { display: flex; align-items: center; gap: 8px; padding: 4px 12px 12px; }
label.name { display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 7px; color: var(--muted); }
label.name:focus-within, label.name:hover { background: var(--hover); color: var(--text); }
label.name svg { width: 14px; height: 14px; }
label.name input { width: 140px; border: 0; padding: 0; background: transparent; color: var(--text); font: 12px var(--font-sans); outline: none; }
#status { flex: 1; min-width: 0; color: var(--muted); font-size: 12px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.send { flex: none; width: 32px; height: 32px; padding: 6px; border: 0; border-radius: 50%; background: var(--send); color: var(--send-foreground); }
button.send:hover { background: color-mix(in srgb, var(--send) 88%, #fff); }

dialog { color: var(--text); }
dialog.viewer { width: min(1000px, 94vw); height: min(86vh, 900px); padding: 0; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: 0 20px 50px #0004; }
dialog::backdrop { background: #0007; }
.viewer-head { display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border); font: 12px var(--font-mono); }
.viewer-head span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.viewer-body { height: calc(100% - 50px); overflow: auto; }
.viewer-body ol { margin: 0; padding: 10px 0; list-style: none; counter-reset: line; font: 12px/1.6 var(--font-mono); }
.viewer-body li { counter-increment: line; white-space: pre-wrap; overflow-wrap: anywhere; padding: 0 14px 0 64px; position: relative; }
.viewer-body li::before { content: counter(line); position: absolute; left: 0; width: 48px; text-align: right; color: var(--muted); }
dialog.lightbox { max-width: 94vw; max-height: 94vh; padding: 0; border: 0; border-radius: 10px; background: transparent; }
dialog.lightbox img { display: block; max-width: 94vw; max-height: 94vh; border-radius: 10px; cursor: zoom-out; }
#ended { max-width: 420px; margin: 30vh auto 0; text-align: center; color: var(--muted); }
#ended h2 { color: var(--text); font-size: 15px; font-weight: 550; margin: 0 0 6px; }
@media (max-width: 640px) { .titlebar-inner, main { padding-left: 16px; padding-right: 16px; } .dock { padding: 20px 12px 12px; } .crumb, .crumb-sep { display: none; } label.name input { width: 100px; } }
`;
