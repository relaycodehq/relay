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
  firstStart,
  openSource,
  otherBuilds,
  platforms,
  REPO,
} = await import("./content");
const { CHECKED, groups, only, ahead, relay, rivals } =
  await import("./compare-data");
const { words, quiet } = await import("./details/words");

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const links = (items: { href: string; text: string }[]) =>
  `<ul>${items.map((i) => `<li><a href="${i.href}">${escape(i.text)}</a></li>`).join("")}</ul>`;
const builds = [...platforms, ...otherBuilds].map((p) => ({
  href: p.href,
  text: `${p.system}: ${p.file}`,
}));
const contact = `<p>Source code: <a href="${REPO}">${REPO}</a>. Contact: <a href="mailto:${EMAIL}">${EMAIL}</a>. Built in the Czech Republic.</p>`;

// Each page draws itself with React, so crawlers and link previews that run
// no script would find an empty root. This puts the page's words there as
// plain HTML, hidden from view; React replaces it on its first render.
const copy: Record<string, string> = {
  home: `<h1>Relay: one workspace for your coding agents</h1>
<p>Relay runs your coding agents on your computer. You see each step. You review each edit. Relay is free and open source under the MIT license.</p>
<h2>It's the small things</h2>
<p>Little details that save a click, a tab or a bad moment.</p>
${words.map((w) => `<h3>${escape(w.title)}</h3><p>${escape(w.text)}</p>`).join("\n")}
<h3>And some you never see</h3>
<ul>${quiet.map((q) => `<li>${escape(q)}</li>`).join("")}</ul>
<h2>Themes</h2>
<p>Relay has built-in themes and takes any VS Code theme from Open VSX, with your own fonts, sizes and accent.</p>
<h2>Open source</h2>
${openSource.map((o) => `<h3>${escape(o.title)}</h3><p>${escape(o.text)} <a href="${o.href}">${escape(o.link)}</a></p>`).join("\n")}
<h2>Common questions</h2>
${faq.map((q) => `<h3>${escape(q.q)}</h3><p>${escape(q.a)}</p>`).join("\n")}
<h2><a href="compare/">How Relay compares</a></h2>
<p>Relay beside ${rivals.map((r) => escape(r.name)).join(", ")}, row by row.</p>
<h2><a href="download/">Download Relay</a></h2>
${contact}`,
  download: `<h1>Download Relay</h1>
<p>Relay is free and open source. Select the build for your system.</p>
${links(builds)}
<h2>First start</h2>
${firstStart.map((f) => `<h3>${escape(f.system)}</h3><p>${escape(f.text)}</p>`).join("\n")}
${contact}`,
  compare: `<h1>How Relay compares</h1>
<p>Relay beside ${rivals.map((r) => escape(r.name)).join(", ")}. Read from each app's public docs on ${CHECKED}.</p>
<h2>Only in Relay</h2>
${only.map((o) => `<h3>${escape(o.title)}</h3><p>${escape(o.text)}</p>`).join("\n")}
${groups
  .map(
    (g) =>
      `<h2>${escape(g.title)}</h2>` +
      g.rows
        .map(
          (row) =>
            `<h3>${escape(row.label)}</h3><ul>${[relay, ...rivals]
              .map((c) => {
                const cell = row.cells[c.id];
                return `<li>${escape(c.name)}: ${cell.mark}${cell.text ? `, ${escape(cell.text)}` : ""}</li>`;
              })
              .join("")}</ul>`,
        )
        .join("\n"),
  )
  .join("\n")}
<h2>Where others are ahead</h2>
${ahead.map((a) => `<h3>${escape(a.title)}</h3><p>${escape(a.text)}</p>`).join("\n")}
${rivals.map((r) => `<h2>Relay or ${escape(r.name)}</h2><p>${escape(r.is)}</p><p>Pick ${escape(r.name)} if: ${escape(r.pickThem)}</p><p>Pick Relay if: ${escape(r.pickRelay)}</p>`).join("\n")}
${contact}`,
};

const pageOf = (path: string) =>
  path.includes("download")
    ? "download"
    : path.includes("compare")
      ? "compare"
      : "home";

const staticCopy = (): Plugin => ({
  name: "static-copy",
  transformIndexHtml: (html, { path }) =>
    html
      .replace(
        '<div id="root"></div>',
        `<div id="root"><div class="static-copy">${copy[pageOf(path)]}</div></div>`,
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
        compare: `${import.meta.dirname}/compare/index.html`,
      },
    },
  },
  worker: { format: "es" },
});
