package dev.relay.android.features.images

import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.TouchInjectionScope
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.doubleClick
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.test.platform.app.InstrumentationRegistry
import dev.relay.android.remote.OfflineCache
import dev.relay.android.remote.Remote
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.credentials.CredentialStore
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.ToastState
import dev.relay.android.ui.theme.RelayTheme
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File

/** Real dialog, pager and image input with local sample images; no pairing or server. */
class LightboxGesturesTest {
    @get:Rule val compose = createComposeRule()
    private val previousLookup = PendingImages.lookup
    private lateinit var remote: Remote
    private var closed = false

    @After fun cleanup() {
        PendingImages.lookup = previousLookup
        if (::remote.isInitialized) remote.stop()
    }

    private fun show(width: Int = 800, height: Int = 400) {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.WHITE)
        val bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        bitmap.recycle()
        val url = "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        PendingImages.lookup = { _, _ -> url }
        val dir = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "lightbox-gesture-tests")
        remote = Remote(CredentialStore(File(dir, "credentials")), OfflineCache(File(dir, "offline")),
            ComputerSeen(File(dir, "seen.json")), "test")
        val images = (1..3).map { LightboxImage(ImageSource.Pending("lightbox-test", it), "Sample image $it") }
        compose.setContent {
            RelayTheme {
                CompositionLocalProvider(LocalToasts provides ToastState()) {
                    Lightbox(remote, images, 1) { closed = true }
                }
            }
        }
        compose.waitUntil(5_000) {
            compose.onAllNodesWithContentDescription("Sample image 2").fetchSemanticsNodes().isNotEmpty()
        }
        assertPage(2)
    }

    private fun assertPage(page: Int) {
        compose.onNodeWithText("$page of 3").assertIsDisplayed()
        compose.runOnIdle { assertFalse("image gesture must not dismiss the viewer", closed) }
    }

    private fun touch(block: TouchInjectionScope.() -> Unit) {
        compose.onNode(isDialog()).performTouchInput(block)
        compose.waitForIdle()
    }

    /** A pinch followed by enough remaining-finger motion to expose accidental pager pickup. */
    private fun pinch(focus: Float, inward: Boolean = false, tail: Float = 0f, lift: Int = 1) {
        touch {
            val x = width * focus
            val from = width * if (inward) 0.18f else 0.08f
            val to = width * if (inward) 0.08f else 0.18f
            down(0, Offset(x - from, centerY))
            down(1, Offset(x + from, centerY))
            repeat(12) { step ->
                val span = from + (to - from) * (step + 1) / 12
                updatePointerTo(0, Offset(x - span, centerY))
                updatePointerTo(1, Offset(x + span, centerY))
                move(16)
            }
            up(lift)
            repeat(8) { moveBy(1 - lift, Offset(width * tail / 8, 0f), 16) }
            up(1 - lift)
        }
    }

    private fun swipeImage(left: Boolean) {
        touch {
            val start = width * if (left) 0.9f else 0.1f
            val end = width * if (left) 0.1f else 0.9f
            swipe(Offset(start, centerY), Offset(end, centerY), 300)
        }
    }

    @Test fun pinchInAndOutAtLeftEdgeNeverChangesImageEvenWithARemainingFinger() {
        show()
        pinch(0.22f, tail = 0.45f)
        assertPage(2)
        pinch(0.22f, inward = true, tail = 0.45f)
        assertPage(2)
    }

    @Test fun pinchInAndOutAtRightEdgeNeverChangesImageWhicheverFingerLiftsFirst() {
        show()
        pinch(0.78f, tail = -0.45f, lift = 0)
        assertPage(2)
        pinch(0.78f, inward = true, tail = -0.45f, lift = 0)
        assertPage(2)
    }

    @Test fun addingASecondFingerCancelsAnAlreadyStartedPageSwipe() {
        show()
        touch {
            down(0, Offset(width * 0.75f, centerY))
            repeat(6) { moveBy(0, Offset(-width * 0.03f, 0f), 16) }
        }
        touch {
            down(1, Offset(width * 0.35f, centerY))
            repeat(6) {
                updatePointerBy(0, Offset(width * 0.02f, 0f))
                updatePointerBy(1, Offset(-width * 0.02f, 0f))
                move(16)
            }
            up(1)
            moveBy(0, Offset(-width * 0.3f, 0f), 100)
            up(0)
        }
        assertPage(2)
    }

    @Test fun panToLeftEdgeThenFreshOutwardSwipeShowsNextAndReturningResetsZoom() {
        show()
        pinch(0.5f)
        swipeImage(left = true)
        assertPage(2)
        swipeImage(left = true)
        assertPage(3)
        swipeImage(left = false)
        assertPage(2)
        swipeImage(left = false)
        assertPage(1)
    }

    @Test fun panToRightEdgeThenFreshOutwardSwipeShowsPreviousImage() {
        show()
        pinch(0.5f)
        swipeImage(left = false)
        assertPage(2)
        swipeImage(left = false)
        assertPage(1)
    }

    @Test fun aZoomedImageWithNoHorizontalOverflowCanStillPage() {
        show(width = 100, height = 1_600)
        pinch(0.5f)
        swipeImage(left = true)
        assertPage(3)
    }

    @Test fun doubleTapStillZoomsAndDoubleTappingAgainRestoresNormalPaging() {
        show()
        touch { doubleClick() }
        swipeImage(left = true)
        assertPage(2)
        touch { doubleClick() }
        swipeImage(left = true)
        assertPage(3)
    }

    @Test fun twoFingerVerticalMotionNeverDismissesButANewOneFingerSwipeStillDoes() {
        show()
        touch {
            down(0, Offset(width * 0.4f, height * 0.3f))
            down(1, Offset(width * 0.6f, height * 0.3f))
            repeat(12) {
                updatePointerBy(0, Offset(0f, height * 0.025f))
                updatePointerBy(1, Offset(0f, height * 0.025f))
                move(16)
            }
            up(0)
            moveBy(1, Offset(0f, height * 0.1f), 50)
            up(1)
        }
        assertPage(2)
        touch { swipe(Offset(centerX, height * 0.3f), Offset(centerX, height * 0.8f), 300) }
        compose.runOnIdle { assertTrue("fresh swipe down dismisses", closed) }
    }
}
