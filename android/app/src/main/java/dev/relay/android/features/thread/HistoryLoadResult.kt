package dev.relay.android.features.thread

/** Identifies the completed request, including failures, so retries cannot consume a stale result. */
data class HistoryLoadResult(val request: Long, val history: Int, val succeeded: Boolean)
