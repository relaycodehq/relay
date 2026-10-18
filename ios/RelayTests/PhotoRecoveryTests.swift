import RelayRemote
import UIKit
import Testing

@testable import Relay

@MainActor
struct PhotoRecoveryTests {
    @Test func testFailedSendReturnsToItsDraftAndKeepsNewerPhotos() {
        let original = UUID().uuidString
        let other = UUID().uuidString
        let sent = photo("sent")
        let newer = photo("newer")
        let elsewhere = photo("elsewhere")
        defer {
            UnsentPhotos.keep([], for: original)
            UnsentPhotos.keep([], for: other)
        }
        // The send cleared its original composer, which then went away.
        UnsentPhotos.keep([], for: original)
        UnsentPhotos.keep([elsewhere], for: other)
        UnsentPhotos.restore([sent], for: original)
        #expect(UnsentPhotos.take(original).map(\.id) == [sent.id])
        #expect(UnsentPhotos.take(other).map(\.id) == [elsewhere.id])

        // Reopening and adding another photo cannot lose either copy on failure.
        UnsentPhotos.keep([newer], for: original)
        #expect(UnsentPhotos.restore([sent], for: original).map(\.id) == [newer.id, sent.id])
        #expect(UnsentPhotos.restore([sent], for: original).map(\.id) == [newer.id, sent.id])
    }

    private func photo(_ name: String) -> PickedPhoto {
        PickedPhoto(image: PastedImage(name: name, mimeType: "image/jpeg", data: Data()), thumbnail: UIImage())
    }
}
