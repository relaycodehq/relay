import RelayRemote
import SwiftUI

/// What the screen around a composer can ask of it.
final class ComposerHandle {
    /// Puts a message taken back from the queue after what's typed, and
    /// answers how to undo that, for when the queue can't let it go after all.
    var restore: (_ text: String, _ images: [PastedImage], _ files: [FileAttachment]) throws -> () -> Void = { _, _, _ in
        throw PairingError("The composer isn't ready yet.")
    }
    /// What a page composed with relay.compose(), in place of what it composed before.
    var compose: (_ text: String, _ earlier: String?) -> Void = { _, _ in }
    /// A quoted passage after what's typed, the field focused.
    var quote: (_ markdown: String) -> Void = { _ in }
}
