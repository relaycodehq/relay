package dev.relay.android.features.applock

import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK
import android.hardware.biometrics.BiometricPrompt
import android.os.CancellationSignal

/**
 * The phone's fingerprint or face, through the system prompt. Weak counts: this only stands in
 * for typing the PIN, it unlocks no key, and most phones' face unlock is weak.
 */
object Biometrics {
    fun available(context: Context): Boolean =
        context.getSystemService(BiometricManager::class.java)?.canAuthenticate(BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS

    /** The system's words for it: "Use fingerprint", "Use face", "Use biometrics". */
    fun label(context: Context): String =
        context.getSystemService(BiometricManager::class.java)?.getStrings(BIOMETRIC_WEAK)?.buttonLabel?.toString()
            ?: "Use biometrics"

    /** Shows the prompt; [done] hears true once recognised, false when given up or cancelled. */
    fun prompt(context: Context, done: (Boolean) -> Unit): CancellationSignal {
        val cancel = CancellationSignal()
        val main = context.mainExecutor
        BiometricPrompt.Builder(context)
            .setTitle("Unlock Relay")
            .setNegativeButton("Use PIN", main) { _, _ -> done(false) }
            .setAllowedAuthenticators(BIOMETRIC_WEAK)
            .build()
            .authenticate(cancel, main, object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = done(true)
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = done(false)
            })
        return cancel
    }
}
