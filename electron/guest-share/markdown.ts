import type { Nodes, Parents, TableRow } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** Where an answer's local picture, video or file link points on the guest page. */
export interface GuestLinks {
  /** The media id of a local image or video the guest may load. */
  media(src: string): { id: string; kind: "image" | "video" } | undefined;
  /** The id of a shared file a link names. */
  file(href: string): string | undefined;
}

/**
 * A message's markdown as HTML for the guest page. Every tag comes from this
 * function and every bit of text is escaped, so whatever the thread holds,
 * raw HTML included, shows as text and nothing runs. Local media becomes a
 * `data-media` id the page loads through the link; remote pictures stay
 * links, so opening the page doesn't call out to other servers.
 */
export function guestHtml(markdown: string, links: GuestLinks) {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  return children(tree, { ...links, urls: definitions(tree) });
}

/** What the guest page reads markdown with: the links, and where `[text][ref]` points. */
interface Context extends GuestLinks {
  urls: Map<string, string>;
}

/** The URLs `[ref]: https://…` lines define, by the name references use. */
function definitions(node: Nodes, urls = new Map<string, string>()) {
  if (node.type === "definition") urls.set(node.identifier, node.url);
  if ("children" in node)
    for (const child of node.children) definitions(child, urls);
  return urls;
}

function children(node: Parents, links: Context): string {
  return node.children.map((child) => html(child, links)).join("");
}

function html(node: Nodes, links: Context): string {
  switch (node.type) {
    case "root":
      return children(node, links);
    case "paragraph":
      return `<p>${children(node, links)}</p>`;
    case "heading":
      return `<h${node.depth}>${children(node, links)}</h${node.depth}>`;
    case "text":
      return escape(node.value);
    case "emphasis":
      return `<em>${children(node, links)}</em>`;
    case "strong":
      return `<strong>${children(node, links)}</strong>`;
    case "delete":
      return `<del>${children(node, links)}</del>`;
    case "inlineCode":
      return `<code>${escape(node.value)}</code>`;
    case "code":
      return `<pre><code${node.lang ? ` data-lang="${escape(node.lang)}"` : ""}>${escape(node.value)}</code></pre>`;
    case "blockquote":
      return `<blockquote>${children(node, links)}</blockquote>`;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const start =
        node.ordered && node.start && node.start !== 1
          ? ` start="${node.start}"`
          : "";
      return `<${tag}${start}>${children(node, links)}</${tag}>`;
    }
    case "listItem": {
      const box =
        typeof node.checked === "boolean"
          ? `<input type="checkbox" disabled${node.checked ? " checked" : ""}> `
          : "";
      return `<li>${box}${children(node, links)}</li>`;
    }
    case "thematicBreak":
      return "<hr>";
    case "break":
      return "<br>";
    case "link":
      return link(node.url, children(node, links), links);
    case "image":
      return image(node.url, node.alt ?? "", links);
    case "linkReference": {
      const url = links.urls.get(node.identifier);
      const label = children(node, links);
      return url ? link(url, label, links) : label;
    }
    case "imageReference": {
      const url = links.urls.get(node.identifier);
      return url ? image(url, node.alt ?? "", links) : escape(node.alt ?? "");
    }
    case "definition":
      return "";
    case "table":
      return `<div class="table"><table>${node.children
        .map((row, i) => tableRow(row, i === 0 ? "th" : "td", links))
        .join("")}</table></div>`;
    case "tableRow":
      return tableRow(node, "td", links);
    case "html":
      // Raw HTML the agent wrote shows as the text it is.
      return escape(node.value);
    default:
      return anything(node, links);
  }
}

/** A node this page has no tag for: its text, or its children's. */
function anything(node: Nodes, links: Context) {
  if ("children" in node) return children(node, links);
  if ("value" in node) return escape(String(node.value));
  return "";
}

function tableRow(row: TableRow, cell: "th" | "td", links: Context) {
  return `<tr>${row.children
    .map((c) => `<${cell}>${children(c, links)}</${cell}>`)
    .join("")}</tr>`;
}

function link(url: string, label: string, links: GuestLinks) {
  if (/^(https?|mailto):/i.test(url))
    return `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  const file = links.file(url);
  if (file) return `<a href="#file=${file}" data-file="${file}">${label}</a>`;
  // A path on the host's computer the guest can't open.
  return `<span class="local-link">${label}</span>`;
}

function image(url: string, alt: string, links: GuestLinks) {
  const media = links.media(url);
  if (media?.kind === "video")
    return `<video data-media="${media.id}" controls preload="metadata"></video>`;
  if (media) return `<img data-media="${media.id}" alt="${escape(alt)}">`;
  if (/^https?:/i.test(url))
    return `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(alt || url)}</a>`;
  return alt ? `<span class="local-link">${escape(alt)}</span>` : "";
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
