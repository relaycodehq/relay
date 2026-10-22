package dev.relay.android.features.diagnostics

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Only called by the recorder's single IO worker. App files, never Android's disposable cache. */
internal class ScrollLogFiles(
    private val directory: File,
    private val segmentBytes: Int = 1024 * 1024,
    private val segments: Int = 8,
    private val incidentBytes: Int = 2 * 1024 * 1024,
    private val incidents: Int = 3,
    private val automaticIncidents: Int = 2,
) {
    private val active get() = File(directory, "recent-0.jsonl")

    init {
        File(directory, "incident-pending.tmp").delete()
        // An interrupted append mustn't glue the next process's first event to half a JSON object.
        if (active.isFile) java.io.RandomAccessFile(active, "rw").use { file ->
            var end = file.length()
            while (end > 0) {
                file.seek(end - 1)
                if (file.readByte() == '\n'.code.toByte()) break
                end--
            }
            if (end != file.length()) file.setLength(end)
        }
    }

    fun append(line: String) {
        directory.mkdirs()
        val bytes = (line + "\n").toByteArray(Charsets.UTF_8)
        // A record is never split across files, nor allowed to exceed the segment limit.
        require(bytes.size <= segmentBytes)
        if (active.length() + bytes.size > segmentBytes) {
            File(directory, "recent-${segments - 1}.jsonl").delete()
            for (i in segments - 2 downTo 0) {
                val from = File(directory, "recent-$i.jsonl")
                if (from.exists()) check(from.renameTo(File(directory, "recent-${i + 1}.jsonl")))
            }
        }
        active.appendBytes(bytes)
    }

    fun keepIncident(automatic: Boolean = false) {
        directory.mkdirs()
        val prefix = if (automatic) "incident-auto-" else "incident-marked-"
        val destination = File(directory, "$prefix${System.currentTimeMillis()}-${System.nanoTime()}.jsonl")
        val recent = recent()
        var remaining = incidentBytes.toLong()
        val parts = mutableListOf<ByteArray>()
        for (file in recent.asReversed()) {
            if (remaining <= 0) break
            val bytes = file.readBytes()
            val start = (bytes.size - remaining).coerceAtLeast(0).toInt()
            // Keep valid JSONL even when the oldest record falls across the byte limit.
            val boundary = if (start == 0) 0 else bytes.indexOfFrom('\n'.code.toByte(), start) + 1
            val part = if (boundary > 0 || start == 0) bytes.copyOfRange(boundary, bytes.size) else byteArrayOf()
            parts.add(0, part)
            remaining -= part.size
            if (start > 0) break
        }
        val pending = File(directory, "incident-pending.tmp")
        pending.outputStream().use { out -> parts.forEach(out::write) }
        check(pending.renameTo(destination))
        saved().filter { it.name.startsWith(prefix) }.dropLast(if (automatic) automaticIncidents else incidents)
            .forEach { check(it.delete()) }
    }

    fun export(destination: File, readme: String) {
        destination.parentFile?.mkdirs()
        ZipOutputStream(destination.outputStream().buffered()).use { zip ->
            zip.putNextEntry(ZipEntry("README.txt"))
            zip.write(readme.toByteArray())
            zip.closeEntry()
            for (file in recent() + saved()) {
                zip.putNextEntry(ZipEntry(file.name))
                file.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
    }

    private fun recent() = (segments - 1 downTo 0).map { File(directory, "recent-$it.jsonl") }.filter(File::isFile)
    private fun saved() = directory.listFiles().orEmpty().filter { it.name.startsWith("incident-") && it.extension == "jsonl" }
        .sortedBy { it.name }

    private fun ByteArray.indexOfFrom(byte: Byte, start: Int): Int {
        for (i in start until size) if (this[i] == byte) return i
        return -1
    }
}
