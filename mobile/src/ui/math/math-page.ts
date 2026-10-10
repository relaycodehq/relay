import type { RenderTheme } from "../../../../shared/html-render";
import { phoneRenderDocument } from "../../../../shared/html-render-phone";
import { katexCss, katexJs } from "./katex-assets";

/** A display formula as a page of its own, typeset by KaTeX inside the WebView. */
export function mathDocument(tex: string, theme: RenderTheme): string {
  // The formula is text from an agent, set inside a script: no way out of it.
  const source = JSON.stringify(tex).replace(/</g, "\\u003c");
  return phoneRenderDocument(
    `<!doctype html><html><head><meta charset="utf-8"><style>${katexCss}
body{padding:2px 0}.katex-display{margin:0;overflow-x:auto;overflow-y:hidden}.katex{font-size:1.1em}</style><script>${katexJs}</script></head><body><div id="math"></div><script>katex.render(${source},document.getElementById("math"),{displayMode:true,throwOnError:false,strict:"ignore",trust:false,output:"htmlAndMathml",maxSize:30,maxExpand:500,errorColor:"var(--danger)"})</script></body></html>`,
    theme,
  );
}
