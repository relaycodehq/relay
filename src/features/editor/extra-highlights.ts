import { highlightingFor, syntaxTree } from "@codemirror/language";
import { Prec, type EditorState, type Range } from "@codemirror/state";
import { Decoration, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { tags as t } from "@lezer/highlight";
import { PRIMITIVES } from "./hover-card/highlight-runs";
import { docTag } from "./syntax-theme";

/** Words that make a constructor's parameter a field too. */
const FIELD_MODIFIERS = new Set(["private", "public", "protected", "readonly"]);

// `/**` and Rust's or C#'s `///` open documentation; `/**/` alone is an empty comment.
function isDocComment(state: EditorState, node: SyntaxNodeRef) {
  const start = state.sliceDoc(node.from, node.from + 4);
  return node.name === "BlockComment"
    ? start.startsWith("/**") && start !== "/**/"
    : start.startsWith("///") && !start.startsWith("////");
}

/** The only nodes `nameStyle` can restyle; the rest are passed by name alone, without building their parents. */
const RESTYLED = new Set(["TypeName", "is", "VariableDefinition", "PropertyDefinition"]);

/** What a name or word is to JetBrains, where the parser's tags don't say. */
function nameStyle(state: EditorState, node: SyntaxNodeRef) {
  if (!RESTYLED.has(node.name) && !node.type.isError) return undefined;
  const text = () => state.sliceDoc(node.from, node.to);
  // `string`, `number` and the like are keywords there.
  if (node.name === "TypeName") return PRIMITIVES.has(text()) ? t.keyword : undefined;
  const parent = node.node.parent?.name;
  // A type guard's `is` is one too. As an arrow's return type the parser can't read the guard, and calls its `is` an error.
  if (node.name === "is" && parent === "TypePredicate") return t.keyword;
  if (node.type.isError) return parent === "TypeAnnotation" && text() === "is" ? t.keyword : undefined;
  if (node.name === "VariableDefinition" && parent === "ParamList") {
    const before = node.node.prevSibling;
    const modified = before && FIELD_MODIFIERS.has(state.sliceDoc(before.from, before.to));
    return modified ? t.definition(t.propertyName) : undefined;
  }
  const isConstructor = node.name === "PropertyDefinition" && parent === "MethodDeclaration" && text() === "constructor";
  return isConstructor ? t.keyword : undefined;
}

function marksIn(view: EditorView) {
  const { state } = view;
  const marks: Range<Decoration>[] = [];
  const mark = (from: number, to: number, tag: Parameters<typeof highlightingFor>[1][number]) => {
    const style = highlightingFor(state, [tag]);
    if (style) marks.push(Decoration.mark({ class: style }).range(from, to));
  };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "BlockComment" || node.name === "LineComment") {
          if (!isDocComment(state, node)) return false;
          mark(node.from, node.to, t.docComment);
          for (const tag of state.sliceDoc(node.from, node.to).matchAll(/(?<=[\s*/])@[A-Za-z]+/g))
            mark(node.from + tag.index, node.from + tag.index + tag[0].length, docTag);
          return false;
        }
        const style = nameStyle(state, node);
        if (style) mark(node.from, node.to, style);
      },
    });
  }
  return Decoration.set(marks, true);
}

/**
 * Colours JetBrains gives that the parser's tags can't tell apart: doc
 * comments and their tags, a constructor's field parameters, and `constructor`,
 * primitive types and a type guard's `is` as keywords. Above the plain highlighting, so these spans are the inner ones.
 */
export const extraHighlights = Prec.high(
  ViewPlugin.fromClass(
    class {
      decorations;
      constructor(view: EditorView) {
        this.decorations = marksIn(view);
      }
      update(update: ViewUpdate) {
        const treeMoved = syntaxTree(update.startState) !== syntaxTree(update.state);
        const restyled = update.transactions.some((tr) => tr.reconfigured);
        if (update.docChanged || update.viewportChanged || treeMoved || restyled)
          this.decorations = marksIn(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
);
