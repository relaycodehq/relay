package dev.relay.android.app.splash

import android.animation.ValueAnimator
import android.app.Activity
import android.graphics.Color
import android.graphics.PixelFormat
import android.opengl.GLSurfaceView
import android.os.Build
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.window.SplashScreenView
import androidx.annotation.RequiresApi
import dev.relay.android.R
import javax.microedition.khronos.egl.EGL10
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.egl.EGLDisplay

/**
 * Takes the system splash over and plays the pull out of it. The system splash (Android 12+) shows
 * splash_mark.png, a still of the ribbon R from the same shaders; an overlay draws that frame on
 * top, the system splash goes from under it, and the ribbon unthreads into the app.
 * [appScale] gets the app's scale as it settles. Older Androids have no splash icon to pull.
 */
fun Activity.handOffSplash(appScale: (Float) -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    splashScreen.setOnExitAnimationListener { splash -> play(splash, appScale) }
}

@RequiresApi(Build.VERSION_CODES.S)
private fun Activity.play(splash: SplashScreenView, appScale: (Float) -> Unit) {
    val icon = splash.iconView
    // No icon (a launch that isn't from the launcher) or animations off: nothing to pull.
    if (icon == null || icon.width == 0 || !ValueAnimator.areAnimatorsEnabled()) {
        splash.remove()
        return
    }
    val at = IntArray(2)
    icon.getLocationInWindow(at)
    // The icon view is the icon's visible 72 units; the system draws the drawable as an adaptive
    // icon's 108-unit layer around it (measured on a Fold7: the still is 1.5× the view).
    val spot = IconSpot(at[0] + icon.width / 2f, at[1] + icon.height / 2f, icon.width * 108f / 72f)
    val bg = getColor(R.color.relay_background)
    val background = floatArrayOf(Color.red(bg) / 255f, Color.green(bg) / 255f, Color.blue(bg) / 255f)

    val decor = window.decorView as ViewGroup
    val overlay = GLSurfaceView(this)
    var splashGone = false
    fun removeSplash() {
        if (!splashGone) splash.remove()
        splashGone = true
    }
    var finished = false
    lateinit var unfocused: ViewTreeObserver.OnWindowFocusChangeListener
    fun finish() {
        if (finished) return
        finished = true
        removeSplash()
        decor.viewTreeObserver.removeOnWindowFocusChangeListener(unfocused)
        decor.removeView(overlay)
        appScale(1f)
    }
    unfocused = ViewTreeObserver.OnWindowFocusChangeListener { focused -> if (!focused) overlay.post { finish() } }
    appScale(PullSplash.APP_SCALE_FROM)
    overlay.setEGLContextClientVersion(3)
    overlay.setEGLConfigChooser(MultisampleChooser())
    overlay.holder.setFormat(PixelFormat.TRANSLUCENT)
    overlay.setZOrderOnTop(true)
    overlay.setRenderer(
        SplashRenderer(
            this,
            background,
            spot,
            // Developer options' animation scale stretches the pull like any other animation.
            timeScale = if (Build.VERSION.SDK_INT >= 33) ValueAnimator.getDurationScale() else 1f,
            onCovering = { overlay.post { if (!finished) removeSplash() } },
            onFailed = { overlay.post { finish() } },
            onFrame = { frame ->
                val scale = frame.appScale
                val done = frame.done
                overlay.post {
                    if (finished) return@post
                    appScale(scale)
                    if (done) finish()
                }
            },
        ),
    )
    decor.addView(overlay, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    // Leaving mid-pull skips the rest; coming back shows the app, not half a splash. A GPU that
    // never draws a frame mustn't leave the splash up either.
    decor.viewTreeObserver.addOnWindowFocusChangeListener(unfocused)
    overlay.postDelayed({ finish() }, ((PullSplash.DURATION + 2) * 1000).toLong())
}

/** RGBA with a depth buffer, 4× multisampled when the GPU offers it; the still was drawn so too. */
private class MultisampleChooser : GLSurfaceView.EGLConfigChooser {
    override fun chooseConfig(egl: EGL10, display: EGLDisplay): EGLConfig =
        pick(egl, display, samples = 4) ?: pick(egl, display, samples = 0)
            ?: error("No EGL config for the splash")

    private fun pick(egl: EGL10, display: EGLDisplay, samples: Int): EGLConfig? {
        val es3 = 0x40 // EGL_OPENGL_ES3_BIT_KHR
        val attributes = intArrayOf(
            EGL10.EGL_RED_SIZE, 8, EGL10.EGL_GREEN_SIZE, 8, EGL10.EGL_BLUE_SIZE, 8, EGL10.EGL_ALPHA_SIZE, 8,
            EGL10.EGL_DEPTH_SIZE, 16, EGL10.EGL_RENDERABLE_TYPE, es3,
            EGL10.EGL_SAMPLE_BUFFERS, if (samples > 0) 1 else 0, EGL10.EGL_SAMPLES, samples,
            EGL10.EGL_NONE,
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val found = IntArray(1)
        return if (egl.eglChooseConfig(display, attributes, configs, 1, found) && found[0] > 0) configs[0] else null
    }
}
