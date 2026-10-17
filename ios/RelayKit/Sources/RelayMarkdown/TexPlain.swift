// Android's TexPlain.kt, a port of shared/tex-plain.ts: a formula as plain
// text for running text, which can't hold a web view. Anything it doesn't
// cover gives nil, and the caller shows the source instead of a
// half-translated formula.

private let symbols: [String: String] = {
    var out: [String: String] = [:]
    let pairs = """
        alpha=α beta=β gamma=γ delta=δ epsilon=ε varepsilon=ε zeta=ζ eta=η theta=θ vartheta=ϑ
        iota=ι kappa=κ lambda=λ mu=μ nu=ν xi=ξ pi=π rho=ρ sigma=σ tau=τ upsilon=υ phi=φ varphi=φ
        chi=χ psi=ψ omega=ω Gamma=Γ Delta=Δ Theta=Θ Lambda=Λ Xi=Ξ Pi=Π Sigma=Σ Phi=Φ Psi=Ψ Omega=Ω
        cdot=· times=× div=÷ pm=± mp=∓ ast=∗ circ=∘ leq=≤ le=≤ geq=≥ ge=≥ neq=≠ ne=≠ approx=≈
        equiv=≡ sim=∼ simeq=≃ propto=∝ ll=≪ gg=≫ to=→ rightarrow=→ leftarrow=← leftrightarrow=↔
        Rightarrow=⇒ Leftarrow=⇐ Leftrightarrow=⇔ mapsto=↦ implies=⇒ iff=⇔ in=∈ notin=∉ subset=⊂
        subseteq=⊆ supset=⊃ supseteq=⊇ cup=∪ cap=∩ emptyset=∅ varnothing=∅ forall=∀ exists=∃ neg=¬
        land=∧ lor=∨ wedge=∧ vee=∨ infty=∞ partial=∂ nabla=∇ sum=∑ prod=∏ int=∫ oint=∮ sqrt=√
        ldots=… cdots=… dots=… vdots=⋮ ell=ℓ hbar=ℏ Re=ℜ Im=ℑ aleph=ℵ wp=℘ therefore=∴ because=∵
        star=⋆ bullet=• oplus=⊕ otimes=⊗ setminus=∖ mid=∣ top=⊤ bot=⊥ ni=∋ subsetneq=⊊ lnot=¬
        sqcup=⊔ uparrow=↑ downarrow=↓ longrightarrow=⟶ Longrightarrow=⟹ hookrightarrow=↪ nearrow=↗
        varsigma=ς Upsilon=Υ lesssim=≲ gtrsim=≳ cong=≅ doteq=≐ triangleq=≜ nmid=∤ angle=∠ perp=⊥
        parallel=∥ degree=° prime=′ langle=⟨ rangle=⟩ lceil=⌈ rceil=⌉ lfloor=⌊ rfloor=⌋
        log=log ln=ln exp=exp sin=sin cos=cos tan=tan min=min max=max lim=lim sup=sup inf=inf
        det=det arg=arg gcd=gcd dim=dim ker=ker Pr=Pr
        {={ }=} %=% &=& #=# _=_ $=$ |=‖
        """
    for pair in pairs.split(whereSeparator: \.isWhitespace) {
        let at = pair.firstIndex(of: "=")!
        out[String(pair[..<at])] = String(pair[pair.index(after: at)...])
    }
    out["quad"] = " "
    out["qquad"] = "  "
    for spacer in [",", ";", ":", " "] { out[spacer] = " " }
    for silent in ["!", "left", "right", "big", "Big", "bigg", "Bigg", "displaystyle"] { out[silent] = "" }
    return out
}()

private let blackboard = ["R": "ℝ", "N": "ℕ", "Z": "ℤ", "Q": "ℚ", "C": "ℂ", "P": "ℙ", "H": "ℍ", "E": "𝔼"]

private func table(_ from: String, _ to: String) -> [Unicode.Scalar: String] {
    Dictionary(uniqueKeysWithValues: zip(from.unicodeScalars, to.unicodeScalars.map { String($0) }))
}

private let superscript = table("0123456789+-=()niTxykmt", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵀˣʸᵏᵐᵗ")

private let subscripts = table("0123456789+-=()aeijkmnoprstxuv", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑᵢⱼₖₘₙₒₚᵣₛₜₓᵤᵥ")

private let accents = [
    "hat": "\u{302}", "bar": "\u{304}", "overline": "\u{304}", "tilde": "\u{303}",
    "vec": "\u{20D7}", "dot": "\u{307}", "ddot": "\u{308}",
]

/// Commands that wrap text whose look is lost here.
private let transparent: Set = [
    "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "boldsymbol", "bm",
    "text", "textrm", "textbf", "textit", "operatorname", "mbox",
]

private struct Unsupported: Error {}

/// The formula in plain text (`x^2` as `x²`, `\alpha \leq 1` as `α ≤ 1`), or nil
/// when it uses anything this doesn't cover.
public func texToPlain(_ tex: String) -> String? {
    var reader = TexReader(tex.trimmingCharacters(in: .whitespacesAndNewlines))
    guard let plain = try? reader.run() else { return nil }
    return collapsingWhitespace(plain)
}

private func collapsingWhitespace(_ text: String) -> String {
    var out = String.UnicodeScalarView()
    var gap = false
    for c in text.unicodeScalars {
        if c.properties.isWhitespace {
            gap = true
            continue
        }
        if gap && !out.isEmpty { out.append(" ") }
        gap = false
        out.append(c)
    }
    return String(out)
}

private func isAsciiLetter(_ c: Unicode.Scalar) -> Bool { ("A"..."Z").contains(c) || ("a"..."z").contains(c) }

private func isLetterOrNumber(_ c: Unicode.Scalar) -> Bool {
    switch c.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
        .decimalNumber, .letterNumber, .otherNumber:
        return true
    default:
        return false
    }
}

/// Letters and digits only, as a root's radicand that needs no brackets.
private func isWord(_ text: String) -> Bool { !text.isEmpty && text.unicodeScalars.allSatisfy(isLetterOrNumber) }

/// What a fraction's top or bottom may be without brackets.
private func isFractionPart(_ text: String) -> Bool {
    !text.isEmpty && text.unicodeScalars.allSatisfy { isLetterOrNumber($0) || $0 == "." || $0 == "′" }
}

/// Kotlin's String.length, which the one-character checks below count in.
private func length(_ text: String) -> Int { text.utf16.count }

private struct TexReader {
    private let src: [Unicode.Scalar]
    private var at = 0

    init(_ tex: String) { src = Array(tex.unicodeScalars) }

    private func peek(_ offset: Int = 0) -> Unicode.Scalar? { at + offset < src.count ? src[at + offset] : nil }

    private mutating func next() -> Unicode.Scalar? {
        defer { at += 1 }
        return peek()
    }

    mutating func run() throws -> String {
        let out = try until()
        if at < src.count { throw Unsupported() }
        return out
    }

    /// Up to an unmatched `}` or the end.
    private mutating func until() throws -> String {
        var out = ""
        while let char = peek(), char != "}" {
            at += 1
            switch char {
            case "\\": out += try command()
            case "{": out += try group()
            case "^", "_": out += try script(char)
            case "~": out += " "
            case "&", "$": throw Unsupported()
            default: out.unicodeScalars.append(char)
            }
        }
        return out
    }

    private mutating func group() throws -> String {
        let inside = try until()
        if next() != "}" { throw Unsupported() }
        return inside
    }

    private mutating func argument() throws -> String {
        while peek() == " " { at += 1 }
        guard let char = next() else { throw Unsupported() }
        switch char {
        case "{": return try group()
        case "\\": return try command()
        default: return String(char)
        }
    }

    private mutating func script(_ kind: Unicode.Scalar) throws -> String {
        let text = try argument()
        let small = text.unicodeScalars.map { (kind == "^" ? superscript : subscripts)[$0] }
        if small.allSatisfy({ $0 != nil }) { return small.map { $0! }.joined() }
        let mark = String(kind)
        return length(text) == 1 ? mark + text : "\(mark)(\(text))"
    }

    private mutating func commandName() throws -> String {
        guard let first = peek() else { throw Unsupported() }
        guard isAsciiLetter(first) else {
            at += 1
            return String(first)
        }
        var name = ""
        while let c = peek(), isAsciiLetter(c) {
            name.unicodeScalars.append(c)
            at += 1
        }
        return name
    }

    private mutating func command() throws -> String {
        let name = try commandName()
        switch name {
        case "frac", "dfrac", "tfrac":
            let top = try argument()
            let bottom = try argument()
            func wrap(_ s: String) -> String { isFractionPart(s) ? s : "(\(s))" }
            return "\(wrap(top))/\(wrap(bottom))"
        case "sqrt":
            let sign = try rootSign()
            let root = try argument()
            return isWord(root) ? sign + root : "\(sign)(\(root))"
        case "mathbb":
            let letter = try argument()
            guard let double = blackboard[letter] else { throw Unsupported() }
            return double
        default:
            break
        }
        if let accent = accents[name] {
            let base = try argument()
            return length(base) == 1 ? base + accent : "\(name)(\(base))"
        }
        if transparent.contains(name) { return try argument() }
        guard let symbol = symbols[name] else { throw Unsupported() }
        return symbol
    }

    /// `\sqrt`'s sign, `∛` or `∜` for a cube or fourth root.
    private mutating func rootSign() throws -> String {
        var k = at
        func skipSpace() { while k < src.count && src[k].properties.isWhitespace { k += 1 } }
        skipSpace()
        guard k < src.count, src[k] == "[" else { return "√" }
        k += 1
        skipSpace()
        var index = ""
        while k < src.count, ("0"..."9").contains(src[k]) {
            index.unicodeScalars.append(src[k])
            k += 1
        }
        skipSpace()
        guard !index.isEmpty, k < src.count, src[k] == "]" else { throw Unsupported() }
        at = k + 1
        switch index {
        case "2": return "√"
        case "3": return "∛"
        case "4": return "∜"
        default: throw Unsupported()
        }
    }
}
