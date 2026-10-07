// Builds the website on its own, with its page at the site's root:
//   npm run build:website   (or npm run deploy:website to put it on relaycode.io)
import { execFileSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const tag = () => {
  try {
    return execFileSync(
      "git",
      ["describe", "--tags", "--abbrev=0", "--match", "v*"],
      {
        encoding: "utf8",
      },
    ).trim();
  } catch {
    return "";
  }
};
const version = tag().replace(/^v/, "") || "dev";
// content.ts reads the version the same way in the config as on the page.
Object.assign(globalThis, { __RELAY_VERSION__: version });
const {
  EMAIL,
  faq,
  features,
  firstStart,
  openSource,
  otherBuilds,
  platforms,
  REPO,
} = await import("./content");

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const links = (items: { href: string; text: string }[]) =>
  `<ul>${items.map((i) => `<li><a href="${i.href}">${escape(i.text)}</a></li>`).join("")}</ul>`;
const builds = [...platforms, ...otherBuilds].map((p) => ({
  href: p.href,
  text: `${p.system}: ${p.file}`,
}));
const contact = `<p>Source code: <a href="${REPO}">${REPO}</a>. Contact: <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>`;

// Each page draws itself with React, so crawlers and link previews that run
// no script would find an empty root. This puts the page's words there as
// plain HTML, hidden from view; React replaces it on its first render.
const copy: Record<string, string> = {
  home: `<h1>Relay: one workspace for your coding agents</h1>
<p>Relay runs your coding agents on your computer. You see each step. You review each edit. Relay is free and open source under the MIT license.</p>
<h2>Features</h2>
${features.map((f) => `<h3>${escape(f.title)}</h3><p>${escape(f.text)}</p>`).join("\n")}
<h2>Themes</h2>
<p>Relay has built-in themes and takes any VS Code theme from Open VSX, with your own fonts, sizes and accent.</p>
<h2>Open source</h2>
${openSource.map((o) => `<h3>${escape(o.title)}</h3><p>${escape(o.text)} <a href="${o.href}">${escape(o.link)}</a></p>`).join("\n")}
<h2>Common questions</h2>
${faq.map((q) => `<h3>${escape(q.q)}</h3><p>${escape(q.a)}</p>`).join("\n")}
<h2><a href="download/">Download Relay</a></h2>
${contact}`,
  download: `<h1>Download Relay</h1>
<p>Relay is free and open source. Select the build for your system.</p>
${links(builds)}
<h2>First start</h2>
${firstStart.map((f) => `<h3>${escape(f.system)}</h3><p>${escape(f.text)}</p>`).join("\n")}
${contact}`,
};

const staticCopy = (): Plugin => ({
  name: "static-copy",
  transformIndexHtml: (html, { path }) =>
    html
      .replace(
        '<div id="root"></div>',
        `<div id="root"><div class="static-copy">${copy[path.includes("download") ? "download" : "home"]}</div></div>`,
      )
      .replaceAll("%RELAY_VERSION%", version),
});

export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  plugins: [react(), staticCopy()],
  define: { __RELAY_VERSION__: JSON.stringify(version) },
  publicDir: "public",
  build: {
    target: "es2022",
    reportCompressedSize: false,
    rollupOptions: {
      input: {
        main: `${import.meta.dirname}/index.html`,
        download: `${import.meta.dirname}/download/index.html`,
      },
    },
  },
  worker: { format: "es" },
});
