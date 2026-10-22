package dev.relay.android.features.diagnostics

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.zip.ZipFile

class ScrollLogFilesTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun boundedHistorySurvivesRestartAndExportsChronologically() {
        val directory = temporary.newFolder()
        fun store() = ScrollLogFiles(directory, segmentBytes = 80, segments = 3, incidentBytes = 90, incidents = 2)
        var logs = store()
        for (i in 1..30) logs.append("{\"event\":$i,\"padding\":\"1234567890\"}")
        val before = directory.listFiles()!!.associate { it.name to it.readText() }
        logs = store()
        assertEquals(before, directory.listFiles()!!.associate { it.name to it.readText() })
        logs.append("{\"event\":31}")
        val zip = File(temporary.newFolder(), "export.zip")
        logs.export(zip, "schema")
        ZipFile(zip).use { archive ->
            val entries = archive.entries().asSequence().toList()
            val events = entries.filter { it.name.endsWith("jsonl") }.flatMap {
                archive.getInputStream(it).bufferedReader().readLines()
            }
            assertTrue(events.first().contains("27"))
            assertEquals("{\"event\":31}", events.last())
            assertEquals("schema", archive.getInputStream(archive.getEntry("README.txt")).bufferedReader().readText())
        }
        assertTrue(directory.listFiles()!!.sumOf { it.length() } <= 3 * 80)
    }

    @Test fun incidentsStayAfterRecentHistoryRotatesAndRespectTheirOwnCap() {
        val directory = temporary.newFolder()
        val logs = ScrollLogFiles(directory, segmentBytes = 80, segments = 2, incidentBytes = 70, incidents = 2)
        for (i in 1..8) logs.append("{\"event\":$i,\"padding\":\"1234567890\"}")
        logs.keepIncident()
        val kept = directory.listFiles()!!.single { it.name.startsWith("incident-") }
        val content = kept.readText()
        for (i in 9..40) logs.append("{\"event\":$i,\"padding\":\"1234567890\"}")
        assertEquals(content, kept.readText())
        assertTrue(kept.length() <= 70)
        assertTrue(content.lines().filter(String::isNotEmpty).all { it.startsWith("{") && it.endsWith("}") })
        logs.keepIncident()
        logs.keepIncident()
        val saved = directory.listFiles()!!.filter { it.name.startsWith("incident-") }
        assertEquals(2, saved.size)
        assertFalse(kept.exists())
        assertTrue(directory.listFiles()!!.sumOf { it.length() } <= 2 * 80 + 2 * 70)
    }

    @Test fun interruptedRecordIsTrimmedWithoutLosingPreviousCompleteRecords() {
        val directory = temporary.newFolder()
        File(directory, "recent-0.jsonl").writeText("{\"ok\":1}\n{\"broken\":")
        val logs = ScrollLogFiles(directory)
        logs.append("{\"ok\":2}")
        assertEquals("{\"ok\":1}\n{\"ok\":2}\n", File(directory, "recent-0.jsonl").readText())
    }

    @Test fun automaticIncidentStormCannotEvictManuallyMarkedHistory() {
        val directory = temporary.newFolder()
        val logs = ScrollLogFiles(directory, segmentBytes = 80, segments = 2, incidentBytes = 70,
            incidents = 3, automaticIncidents = 2)
        logs.append("{\"marked\":true}")
        logs.keepIncident()
        val marked = directory.listFiles()!!.single { it.name.startsWith("incident-marked-") }
        val content = marked.readText()
        repeat(10) { logs.append("{\"later\":$it}"); logs.keepIncident(automatic = true) }
        assertEquals(content, marked.readText())
        assertEquals(2, directory.listFiles()!!.count { it.name.startsWith("incident-auto-") })
    }
}
