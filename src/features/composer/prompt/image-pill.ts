import { Node, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { formatSize } from "../../../lib/file-tree";
import { imageToken } from "../../../../shared/image-refs";
import { copiedPill } from "../../images/image-clipboard";
import { imagePill, pillClass } from "./Pill";

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
  // Copied, it carries its screenshot, which another draft pastes back in with it.
  renderHTML({ node }) {
    const n: number = node.attrs.n;
    // The editor's storage: the schema's own copy never sees the screenshots.
    const image = this.editor?.storage.relayImage.images.get(n);
    if (!image) return ["span", { "data-relay-image": "" }, imageToken(n)];
    return ["img", { ...copiedPill(n, image.name), src: image.src }];
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
      // Flags are toggled, not set: ProseMirror adds its own classes here.
      dom.className = pillClass("image");
      dom.contentEditable = "false";
      dom.dataset.relayImage = "";
      dom.dataset.n = String(n);
      const remove = document.createElement("span");
      remove.className = "prompt-pill-remove";
      remove.setAttribute("role", "button");
      const draw = () => {
        const image = storage.images.get(n);
        const look = imagePill(n, image?.name);
        dom.classList.toggle("missing", look.missing);
        dom.classList.toggle("pasted", look.pasted);
        dom.title = image
          ? `${image.name} · ${formatSize(image.bytes)}, sent as ${imageToken(n)}. Click to draw on it.`
          : "This screenshot is no longer in the draft";
        remove.setAttribute(
          "aria-label",
          `Remove ${look.label ?? `Image #${n}`}`,
        );
        let thumb: HTMLElement;
        if (image) {
          const picture = document.createElement("img");
          picture.src = image.src;
          picture.alt = look.label ? "" : `Image #${n}`;
          thumb = picture;
        } else {
          thumb = document.createElement("span");
          thumb.setAttribute("aria-hidden", "true");
        }
        thumb.className = "prompt-pill-thumb";
        const label = document.createElement("span");
        label.className = "prompt-pill-label";
        label.textContent = look.label ?? "";
        dom.replaceChildren(thumb, ...(look.label ? [label] : []), remove);
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
