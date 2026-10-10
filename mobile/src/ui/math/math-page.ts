import type { RenderTheme } from "../../../../shared/html-render";
import { phoneRenderDocument } from "../../../../shared/html-render-phone";
import { katexCss, katexFonts, katexJs } from "./katex-assets";

/** What every formula may draw with: text, variables, big operators and delimiters, AMS symbols. */
const ALWAYS = [
  "Main-Regular",
  "Main-Italic",
  "Math-Italic",
  "AMS-Regular",
  "Size1-Regular",
  "Size2-Regular",
  "Size3-Regular",
  "Size4-Regular",
];
/** The faces a command in the formula asks for beyond those. */
const ASKED: [RegExp, string[]][] = [
  [
    /\\(?:mathbf|boldsymbol|bm|bf|textbf|pmb|bold)(?![A-Za-z])/,
    ["Main-Bold", "Main-BoldItalic", "Math-BoldItalic"],
  ],
  [
    /\\(?:mathcal|cal)(?![A-Za-z])/,
    ["Caligraphic-Regular", "Caligraphic-Bold"],
  ],
  [/\\(?:mathfrak|frak)(?![A-Za-z])/, ["Fraktur-Regular", "Fraktur-Bold"]],
  [/\\mathscr(?![A-Za-z])/, ["Script-Regular"]],
  [
    /\\(?:mathsf|textsf|sf|mathsfit)(?![A-Za-z])/,
    ["SansSerif-Regular", "SansSerif-Bold", "SansSerif-Italic"],
  ],
  [/\\(?:mathtt|texttt|tt)(?![A-Za-z])/, ["Typewriter-Regular"]],
];

/** The font faces `tex` draws with, rather than all of KaTeX's ~340 KB of them. */
export function fontsFor(tex: string): string {
  const names = new Set(ALWAYS);
  for (const [command, faces] of ASKED)
    if (command.test(tex)) for (const face of faces) names.add(face);
  return [...names].map((name) => katexFonts[name] ?? "").join("");
}

/** A display formula as a page of its own, typeset by KaTeX inside the WebView. */
export function mathDocument(tex: string, theme: RenderTheme): string {
  // The formula is text from an agent, set inside a script: no way out of it.
  const source = JSON.stringify(tex).replace(/</g, "\\u003c");
  return phoneRenderDocument(
    `<!doctype html><html><head><meta charset="utf-8"><style>${fontsFor(tex)}${katexCss}
body{padding:2px 0}.katex-display{margin:0;overflow-x:auto;overflow-y:hidden}.katex{font-size:1.1em}</style><script>${katexJs}</script></head><body><div id="math"></div><script>katex.render(${source},document.getElementById("math"),{displayMode:true,throwOnError:false,strict:"ignore",trust:false,output:"htmlAndMathml",maxSize:30,maxExpand:500,errorColor:"var(--danger)"})</script></body></html>`,
    theme,
  );
}
