package dev.relay.android.remote.model

import kotlinx.serialization.json.Json

/** The bridge's JSON: unknown fields ignored (newer desktops), absent ones left out on the way back. */
val RemoteJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
    coerceInputValues = true
}
