package dev.relay.android.features.dictation

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import kotlin.math.log10
import kotlin.math.pow

/** shared/dictation.ts's text helpers, plus the phone's chunk encoding and loudness. */

private val firstWord = Regex("^\\p{L}[\\p{L}']*")
private val sentenceEnd = Regex("[.!?…][\"')\\]]?\\s*$")
private val pronounI = Regex("^I('|$)")
private val capitalised = Regex("^\\p{Lu}\\p{Ll}*('\\p{Ll}+)?$")

/** The model starts every phrase with a capital; mid-sentence it shouldn't: "Please fix", not "Please Fix". */
fun fitCase(words: String, before: String): String {
    val first = firstWord.find(words)?.value ?: return words
    val sentenceStart = before.isBlank() || sentenceEnd.containsMatchIn(before)
    if (sentenceStart) return words.substring(0, 1).uppercase() + words.substring(1)
    if (pronounI.containsMatchIn(first) || !capitalised.matches(first)) return words
    return words.substring(0, 1).lowercase() + words.substring(1)
}

private val leadingMark = Regex("^[.,!?;:…]")
private val trailingMarks = Regex("[.,!?;:…]+$")
private val leadingLower = Regex("^\\p{Ll}")
private val trailingDot = Regex("\\.$")

/** The model ends every phrase like a sentence; before more of it, or punctuation, that ending goes. */
fun fitEnd(words: String, after: String): String {
    val next = after.trimStart()
    if (leadingMark.containsMatchIn(next)) return words.replace(trailingMarks, "")
    if (leadingLower.containsMatchIn(next)) return words.replace(trailingDot, "")
    return words
}

data class Placed(val text: String, val start: Int, val end: Int)

private val endsInSpace = Regex("\\s$")
private val startsTight = Regex("^[\\s.,!?;:)\\]]")

/** Dictated `words` in `text` in place of `from`–`to`, spaced from the text around them. */
fun placeDictation(text: String, from: Int, to: Int, words: String): Placed {
    val before = text.substring(0, from)
    val after = text.substring(to)
    val fitted = fitEnd(fitCase(words, before.substring(before.lastIndexOf('\n') + 1)), after.substringBefore('\n'))
    if (fitted.isEmpty()) return Placed(before + after, from, from)
    val lead = if (before.isNotEmpty() && !endsInSpace.containsMatchIn(before)) " " else ""
    val trail = if (after.isNotEmpty() && !startsTight.containsMatchIn(after)) " " else ""
    val start = from + lead.length
    return Placed(before + lead + fitted + trail + after, start, start + fitted.length)
}

/**
 * Loudness 0–1 from a chunk's mean square. The phone's speech source has no
 * gain control, so speech sits lower than on the desktop; this puts it near
 * the middle, as the desktop's waveform does.
 */
fun loudness(power: Double): Float {
    val db = 10 * log10(power + 1e-10)
    return ((db + 55) / 38).coerceIn(0.0, 1.0).pow(1.8).toFloat()
}

/** A chunk as the desktop takes it: 16-bit little-endian PCM in base64, and its mean square. */
fun encodeChunk(samples: ShortArray, length: Int): Pair<String, Double> {
    val bytes = ByteBuffer.allocate(length * 2).order(ByteOrder.LITTLE_ENDIAN)
    var sum = 0.0
    for (i in 0 until length) {
        bytes.putShort(samples[i])
        val s = samples[i] / 32768.0
        sum += s * s
    }
    return Base64.getEncoder().encodeToString(bytes.array()) to if (length > 0) sum / length else 0.0
}
