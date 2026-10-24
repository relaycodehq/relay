package dev.relay.android.features.composer.logic

import dev.relay.android.remote.files.fileSize

enum class FilePhase { Preparing, Ready, Uploading, Failed, Refused }

/** The line under a file's name in the composer's strip. */
fun fileStatus(phase: FilePhase, video: Boolean, size: Long?, percent: Int): String = when (phase) {
    FilePhase.Preparing -> if (video) "Compressing…" else size?.let(::fileSize).orEmpty()
    FilePhase.Uploading -> "Uploading $percent%"
    FilePhase.Failed -> "Couldn't upload"
    FilePhase.Ready, FilePhase.Refused -> size?.let(::fileSize).orEmpty()
}
