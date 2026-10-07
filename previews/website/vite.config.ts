// Builds the website on its own, with its page at the site's root:
//   npm run build:website   (or npm run deploy:website to put it on relaycode.io)
import { execFileSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const tag = () => {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
};
const version = tag().replace(/^v/, "") || "dev";
// content.ts reads the version the same way in the config as on the page.
Object.assign(globalThis, { __RELAY_VERSION__: version });
const { faq, features, platforms } = await import("./content");

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The page draws itself with React, so crawlers and link previews that run no
// script would find an empty root. This puts the page's words there as plain
// HTML, hidden from view; React replaces it on its first render.
const staticCopy = (): Plugin => ({
  name: "static-copy",
  transformIndexHtml: (html) =>
    html.replace(
      '<div id="root"></div>',
      `<div id="root"><div class="static-copy">
<h1>Relay: one workspace for your coding agents</h1>
<p>Relay runs your coding agents on your computer. You see each step. You review each edit.</p>
<h2>Features</h2>
${features.map((f) => `<h3>${escape(f.title)}</h3><p>${escape(f.text)}</p>`).join("\n")}
<h2>Download Relay</h2>
<ul>${platforms.map((p) => `<li><a href="${p.href}">${escape(p.system)}: ${escape(p.file)}</a></li>`).join("")}</ul>
<h2>Common questions</h2>
${faq.map((q) => `<h3>${escape(q.q)}</h3><p>${escape(q.a)}</p>`).join("\n")}
</div></div>`,
    ),
});

export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  plugins: [react(), staticCopy()],
  define: { __RELAY_VERSION__: JSON.stringify(version) },
  publicDir: "public",
  build: { target: "es2022", reportCompressedSize: false },
  worker: { format: "es" },
});
