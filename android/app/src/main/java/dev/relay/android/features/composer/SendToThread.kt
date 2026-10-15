package dev.relay.android.features.composer

import dev.relay.android.features.composer.logic.composeSend
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.NotConnected
import dev.relay.android.remote.drafts.Sends
import dev.relay.android.remote.model.ResumeSettings
import dev.relay.android.remote.outbox.outboxLink
import java.io.File
import java.util.UUID

/**
 * [text] to thread [chatId] as its composer would send it, through the
 * outbox: on [settings], the thread's last, else the computer's new-thread
 * pick (mobile/src/app/turn.tsx's onAskAgent).
 */
suspend fun sendToThread(remote: Remote, filesDir: File, chatId: String, text: String, settings: ResumeSettings?) {
    val client = remote.client.value ?: throw NotConnected("Not connected to your computer.")
    val computer = remote.active.value ?: throw IllegalStateException("Pick a computer first.")
    val using = settings ?: client.desktopNewThread().first
    val send = composeSend(using, text, id = UUID.randomUUID().toString())
    Sends.outbox(filesDir).deliver(outboxLink(client), computer, chatId, send)
}
