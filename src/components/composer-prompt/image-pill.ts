import { Node, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { formatSize } from "../../lib/file-tree";
import {
  imageToken,
  isPastedImageName,
  shortImageName,
} from "../../lib/image-refs";

/** What an image pill shows; the screenshot itself stays with the composer. */
export interface ImageChip {
  n: number;
  name: string;
  src: string;
  bytes: number;
}
interface ImageStorage {
  images: Map<number, ImageChip>;
  /** Live pills, redrawn when the screenshots behind them load or change. */
  views: Set<() => void>;
}
declare module "@tiptap/core" {
  interface Storage {
    relayImage: ImageStorage;
  }
}
// A screenshot's place in the message; sent as `[Image #n]`, the image itself rides along.
export const ImageTag = Node.create<object, ImageStorage>({
  name: "relayImage",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { n: { default: 1 } };
  },
  addStorage() {
    return { images: new Map(), views: new Set() };
  },
  parseHTML() {
    return [{ tag: "span[data-relay-image]" }];
  },
  renderHTML({ node }) {
    return ["span", { "data-relay-image": "" }, imageToken(node.attrs.n)];
  },
  renderText({ node }) {
    return imageToken(node.attrs.n);
  },
  // A text selection across a pill outlines it; painting its insides blotches.
  addProseMirrorPlugins() {
    const name = this.name;
    return [
      new Plugin({
        props: {
          decorations({ doc, selection }) {
            if (selection.empty) return null;
            const marked: Decoration[] = [];
            doc.nodesBetween(selection.from, selection.to, (node, pos) => {
              if (node.type.name === name)
                marked.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "in-selection",
                  }),
                );
            });
            return DecorationSet.create(doc, marked);
          },
        },
      }),
    ];
  },
  addNodeView() {
    const storage = this.storage;
    return ({ node }) => {
      const n: number = node.attrs.n;
      const dom = document.createElement("span");
      dom.className =
        "composer-skill-chip composer-file-chip composer-image-chip";
      dom.contentEditable = "false";
      dom.dataset.relayImage = "";
      dom.dataset.n = String(n);
      const draw = () => {
        const image = storage.images.get(n);
        // A paste's name says nothing, so its pill is just the picture.
        const pasted = !!image && isPastedImageName(image.name);
        dom.classList.toggle("missing", !image);
        dom.classList.toggle("pasted", pasted);
        dom.title = image
          ? `${image.name} · ${formatSize(image.bytes)}, sent as ${imageToken(n)}. Click to draw on it.`
          : "This screenshot is no longer in the draft";
        dom.replaceChildren();
        if (image) {
          const thumb = document.createElement("img");
          thumb.className = "composer-image-chip-thumb";
          thumb.src = image.src;
          thumb.alt = pasted ? `Image #${n}` : "";
          dom.append(thumb);
        } else {
          const thumb = document.createElement("span");
          thumb.className = "composer-image-chip-thumb";
          thumb.setAttribute("aria-hidden", "true");
          dom.append(thumb);
        }
        if (!pasted) {
          const label = document.createElement("span");
          label.textContent = image
            ? shortImageName(image.name)
            : `Image #${n}`;
          dom.append(label);
        }
      };
      draw();
      storage.views.add(draw);
      return {
        dom,
        update: (next) => next.type === node.type && next.attrs.n === n,
        destroy: () => storage.views.delete(draw),
      };
    };
  },
});

/** Gives the screenshot pills the draft's screenshots, redrawing the ones showing. */
export function showImages(editor: Editor, images: ImageChip[] | undefined) {
  const storage = editor.storage.relayImage;
  storage.images = new Map(images?.map((image) => [image.n, image]));
  for (const draw of storage.views) draw();
}
