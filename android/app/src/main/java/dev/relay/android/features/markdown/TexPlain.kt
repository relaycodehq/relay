package dev.relay.android.features.markdown

// Port of shared/tex-plain.ts: a formula as plain text for running text, which
// can't hold a WebView. Anything it doesn't cover gives null, and the caller
// shows the source instead of a half-translated formula.

private val SYMBOLS: Map<String, String> = buildMap {
    fun put(pairs: String) = pairs.trim().split(Regex("\\s+")).forEach {
        val at = it.indexOf('=')
        put(it.substring(0, at), it.substring(at + 1))
    }
    put(
        """
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
        """,
    )
    put("quad", " ")
    put("qquad", "  ")
    for (spacer in listOf(",", ";", ":", " ")) put(spacer, " ")
    for (silent in listOf("!", "left", "right", "big", "Big", "bigg", "Bigg", "displaystyle")) put(silent, "")
}

private val BLACKBOARD = mapOf(
    "R" to "ℝ", "N" to "ℕ", "Z" to "ℤ", "Q" to "ℚ", "C" to "ℂ", "P" to "ℙ", "H" to "ℍ", "E" to "𝔼",
)

private fun table(from: String, to: String): Map<Char, String> {
    val targets = to.codePoints().toArray().map { String(Character.toChars(it)) }
    return from.toList().zip(targets).toMap()
}

private val SUPERSCRIPT = table("0123456789+-=()niTxykmt", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵀˣʸᵏᵐᵗ")

private val SUBSCRIPT = table("0123456789+-=()aeijkmnoprstxuv", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑᵢⱼₖₘₙₒₚᵣₛₜₓᵤᵥ")

private val ACCENTS = mapOf(
    "hat" to "̂", "bar" to "̄", "overline" to "̄", "tilde" to "̃",
    "vec" to "⃗", "dot" to "̇", "ddot" to "̈",
)

/** Commands that wrap text whose look is lost here. */
private val TRANSPARENT = setOf(
    "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "boldsymbol", "bm",
    "text", "textrm", "textbf", "textit", "operatorname", "mbox",
)

private class Unsupported : Exception()

/** The formula in plain text, or null when it uses anything this doesn't cover. */
fun texToPlain(tex: String): String? = try {
    TexReader(tex.trim()).run().replace(Regex("\\s+"), " ").trim()
} catch (_: Unsupported) {
    null
}

private val WORD = Regex("^[\\p{L}\\p{N}]+$")
private val FRACTION_PART = Regex("^[\\p{L}\\p{N}.′]+$")
private val COMMAND_NAME = Regex("^[A-Za-z]+|^[^A-Za-z]")
private val ROOT_INDEX = Regex("^\\s*\\[\\s*(\\d+)\\s*]")
private val ROOT_OPEN = Regex("^\\s*\\[")

private class TexReader(private val src: String) {
    private var at = 0

    fun run(): String {
        val out = until()
        if (at < src.length) throw Unsupported()
        return out
    }

    /** Up to an unmatched `}` or the end. */
    private fun until(): String {
        val out = StringBuilder()
        while (at < src.length && src[at] != '}') {
            when (val char = src[at++]) {
                '\\' -> out.append(command())
                '{' -> out.append(group())
                '^', '_' -> out.append(script(char))
                '~' -> out.append(' ')
                '&', '$' -> throw Unsupported()
                else -> out.append(char)
            }
        }
        return out.toString()
    }

    private fun group(): String {
        val inside = until()
        if (src.getOrNull(at++) != '}') throw Unsupported()
        return inside
    }

    private fun argument(): String {
        while (src.getOrNull(at) == ' ') at++
        val char = src.getOrNull(at++) ?: throw Unsupported()
        return when (char) {
            '{' -> group()
            '\\' -> command()
            else -> char.toString()
        }
    }

    private fun script(kind: Char): String {
        val text = argument()
        val table = if (kind == '^') SUPERSCRIPT else SUBSCRIPT
        val small = text.map { table[it] }
        if (small.all { it != null }) return small.joinToString("")
        return if (text.length == 1) "$kind$text" else "$kind($text)"
    }

    private fun command(): String {
        val name = COMMAND_NAME.find(src.substring(at))?.value ?: throw Unsupported()
        at += name.length
        when (name) {
            "frac", "dfrac", "tfrac" -> {
                val top = argument()
                val bottom = argument()
                fun wrap(s: String) = if (FRACTION_PART.matches(s)) s else "($s)"
                return "${wrap(top)}/${wrap(bottom)}"
            }
            "sqrt" -> {
                val sign = rootSign()
                val root = argument()
                return if (WORD.matches(root)) "$sign$root" else "$sign($root)"
            }
            "mathbb" -> return BLACKBOARD[argument()] ?: throw Unsupported()
        }
        ACCENTS[name]?.let { accent ->
            val base = argument()
            return if (base.length == 1) base + accent else "$name($base)"
        }
        if (name in TRANSPARENT) return argument()
        return SYMBOLS[name] ?: throw Unsupported()
    }

    /** `\sqrt`'s sign, `∛` or `∜` for a cube or fourth root. */
    private fun rootSign(): String {
        val rest = src.substring(at)
        val index = ROOT_INDEX.find(rest)
        if (index == null) {
            if (ROOT_OPEN.containsMatchIn(rest)) throw Unsupported()
            return "√"
        }
        at += index.value.length
        return when (index.groupValues[1]) {
            "2" -> "√"
            "3" -> "∛"
            "4" -> "∜"
            else -> throw Unsupported()
        }
    }
}
