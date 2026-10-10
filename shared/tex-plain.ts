// A formula as plain text, for where nothing can typeset it: a phone's running
// text can't hold a WebView. Covers what turns up inside sentences (variables,
// powers, fractions, Greek, common operators); anything else comes back null,
// and the caller shows the source instead of a half-translated formula.

const SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  ast: "∗",
  circ: "∘",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  simeq: "≃",
  propto: "∝",
  ll: "≪",
  gg: "≫",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  mapsto: "↦",
  implies: "⇒",
  iff: "⇔",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  land: "∧",
  lor: "∨",
  wedge: "∧",
  vee: "∨",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  sum: "∑",
  prod: "∏",
  int: "∫",
  oint: "∮",
  sqrt: "√",
  ldots: "…",
  cdots: "…",
  dots: "…",
  vdots: "⋮",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  degree: "°",
  prime: "′",
  langle: "⟨",
  rangle: "⟩",
  lceil: "⌈",
  rceil: "⌉",
  lfloor: "⌊",
  rfloor: "⌋",
  log: "log",
  ln: "ln",
  exp: "exp",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  min: "min",
  max: "max",
  lim: "lim",
  sup: "sup",
  inf: "inf",
  det: "det",
  arg: "arg",
  gcd: "gcd",
  dim: "dim",
  ker: "ker",
  Pr: "Pr",
  quad: " ",
  qquad: "  ",
  ",": " ",
  ";": " ",
  ":": " ",
  " ": " ",
  "!": "",
  "{": "{",
  "}": "}",
  "%": "%",
  "&": "&",
  "#": "#",
  _: "_",
  $: "$",
  "|": "‖",
  left: "",
  right: "",
  big: "",
  Big: "",
  bigg: "",
  Bigg: "",
  displaystyle: "",
};
const BLACKBOARD: Record<string, string> = {
  R: "ℝ",
  N: "ℕ",
  Z: "ℤ",
  Q: "ℚ",
  C: "ℂ",
  P: "ℙ",
  H: "ℍ",
  E: "𝔼",
};
const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
  T: "ᵀ",
  x: "ˣ",
  y: "ʸ",
  k: "ᵏ",
  m: "ᵐ",
  t: "ᵗ",
};
const SUBSCRIPT: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  x: "ₓ",
  u: "ᵤ",
  v: "ᵥ",
};
const ACCENTS: Record<string, string> = {
  hat: "̂",
  bar: "̄",
  overline: "̄",
  tilde: "̃",
  vec: "⃗",
  dot: "̇",
  ddot: "̈",
};
/** Commands that wrap text whose look is lost here. */
const TRANSPARENT = new Set([
  "mathrm",
  "mathbf",
  "mathit",
  "mathsf",
  "mathtt",
  "mathcal",
  "boldsymbol",
  "bm",
  "text",
  "textrm",
  "textbf",
  "textit",
  "operatorname",
  "mbox",
]);

class Unsupported extends Error {}

/** The formula in plain text, or null when it uses anything this doesn't cover. */
export function texToPlain(tex: string): string | null {
  try {
    return new Reader(tex.trim()).run().replace(/\s+/g, " ").trim();
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}

class Reader {
  private at = 0;
  constructor(private src: string) {}

  run() {
    const out = this.until();
    if (this.at < this.src.length) throw new Unsupported();
    return out;
  }

  /** Up to an unmatched `}` or the end. */
  private until(): string {
    let out = "";
    while (this.at < this.src.length && this.src[this.at] !== "}") {
      const char = this.src[this.at++]!;
      if (char === "\\") out += this.command();
      else if (char === "{") out += this.group();
      else if (char === "^" || char === "_") out += this.script(char);
      else if (char === "~") out += " ";
      else if (char === "&" || char === "$") throw new Unsupported();
      else out += char;
    }
    return out;
  }

  /** The inside of a `{…}` whose opening brace is read. */
  private group() {
    const inside = this.until();
    if (this.src[this.at++] !== "}") throw new Unsupported();
    return inside;
  }

  /** One argument: a group, a command's result or a character. */
  private argument(): string {
    while (this.src[this.at] === " ") this.at++;
    const char = this.src[this.at++];
    if (char === undefined) throw new Unsupported();
    if (char === "{") return this.group();
    if (char === "\\") return this.command();
    return char;
  }

  private script(kind: "^" | "_") {
    const text = this.argument();
    const table = kind === "^" ? SUPERSCRIPT : SUBSCRIPT;
    const small = [...text].map((c) => table[c]);
    if (small.every(Boolean)) return small.join("");
    return text.length === 1 ? `${kind}${text}` : `${kind}(${text})`;
  }

  private command(): string {
    const name = /^[A-Za-z]+|^[^A-Za-z]/.exec(this.src.slice(this.at))?.[0];
    if (!name) throw new Unsupported();
    this.at += name.length;
    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const top = this.argument(),
        bottom = this.argument();
      const wrap = (s: string) => (/^[\p{L}\p{N}.′]+$/u.test(s) ? s : `(${s})`);
      return `${wrap(top)}/${wrap(bottom)}`;
    }
    if (name === "sqrt") {
      const root = this.argument();
      return /^[\p{L}\p{N}]+$/u.test(root) ? `√${root}` : `√(${root})`;
    }
    if (name === "mathbb") {
      const letter = this.argument();
      const mapped = BLACKBOARD[letter];
      if (!mapped) throw new Unsupported();
      return mapped;
    }
    if (name in ACCENTS) {
      const base = this.argument();
      return base.length === 1 ? base + ACCENTS[name] : `${name}(${base})`;
    }
    if (TRANSPARENT.has(name)) return this.argument();
    const symbol = SYMBOLS[name];
    if (symbol === undefined) throw new Unsupported();
    return symbol;
  }
}
