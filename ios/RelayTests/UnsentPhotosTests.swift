import RelayRemote
import Testing
import UIKit

@testable import Relay

@MainActor
struct UnsentPhotosTests {
    @Test func testProjectSwitchCarriesAllPhotosAndClearsTheOldDraft() {
        let computer = UUID().uuidString
        let photos = (0..<4).map {
            PickedPhoto(
                image: PastedImage(name: "photo-\($0).jpg", mimeType: "image/jpeg", data: Data()), thumbnail: UIImage())
        }
        UnsentPhotos.keep(Array(photos.prefix(2)), for: "\(computer)\nfirst")
        UnsentPhotos.keep(Array(photos.suffix(2)), for: "\(computer)\nsecond")
        defer {
            UnsentPhotos.keep([], for: "\(computer)\nfirst")
            UnsentPhotos.keep([], for: "\(computer)\nsecond")
        }
        UnsentPhotos.move(computer, from: "first", to: "second")
        #expect(UnsentPhotos.take("\(computer)\nfirst").isEmpty)
        // More than the send limit must remain available for the user to choose which to remove.
        #expect(
            UnsentPhotos.take("\(computer)\nsecond").map(\.id)
                == [photos[2], photos[3], photos[0], photos[1]].map(\.id))
        UnsentPhotos.move(computer, from: "second", to: "first")
        #expect(Set(UnsentPhotos.take("\(computer)\nfirst").map(\.id)) == Set(photos.map(\.id)))
        #expect(UnsentPhotos.take("\(computer)\nsecond").isEmpty)
        UnsentPhotos.move(computer, from: "first", to: "first")
        #expect(UnsentPhotos.take("\(computer)\nfirst").count == 4)
    }
}
