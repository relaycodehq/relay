package dev.relay.android.features.composer.logic

import org.junit.Assert.assertEquals
import org.junit.Test

class FileStatusTest {
    @Test fun `the strip says what a file is doing`() {
        assertEquals("Compressing…", fileStatus(FilePhase.Preparing, video = true, size = 90_000_000, percent = 0))
        assertEquals("4.2 MB", fileStatus(FilePhase.Preparing, video = false, size = 4_200_000, percent = 0))
        assertEquals("Uploading 42%", fileStatus(FilePhase.Uploading, video = true, size = 9_000_000, percent = 42))
        assertEquals("Couldn't upload", fileStatus(FilePhase.Failed, video = false, size = 1, percent = 0))
        assertEquals("12.4 MB", fileStatus(FilePhase.Ready, video = true, size = 12_400_000, percent = 100))
    }
}
