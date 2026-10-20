package dev.relay.android.features.applock

import kotlinx.serialization.Serializable
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** A PIN as PBKDF2-HMAC-SHA256 of a random salt; iOS: RelayKit's `StoredPin`, same bytes. */
@Serializable
data class StoredPin(val salt: String, val hash: String, val rounds: Int) {
    fun matches(pin: String): Boolean =
        MessageDigest.isEqual(derive(pin, decode(salt), rounds), decode(hash))

    companion object {
        const val ROUNDS = 100_000

        fun of(pin: String, salt: ByteArray = ByteArray(16).also(SecureRandom()::nextBytes), rounds: Int = ROUNDS) =
            StoredPin(encode(salt), encode(derive(pin, salt, rounds)), rounds)

        private fun derive(pin: String, salt: ByteArray, rounds: Int): ByteArray =
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                .generateSecret(PBEKeySpec(pin.toCharArray(), salt, rounds, 256)).encoded

        private fun encode(bytes: ByteArray) = Base64.getEncoder().encodeToString(bytes)
        private fun decode(text: String) = Base64.getDecoder().decode(text)
    }
}
