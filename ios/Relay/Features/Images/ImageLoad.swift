import RelayRemote
import SwiftUI
import UIKit

/// A picture from the computer: nil while it loads, `failed` once it was refused.
struct LoadedImage {
    var image: UIImage?
    var failed = false
}

/// Pictures by computer, source and size, so a row mounted again or scrolled back to
/// draws at once; and the ones refused, which the lightbox leaves out.
@MainActor
enum Pictures {
    private static let decoded: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 48 << 20
        return cache
    }()
    private static var loading: [String: Task<UIImage, Error>] = [:]
    private static var refused: Set<String> = []

    /// The most pixels `image` takes for a side.
    static let largest = 4096

    private static func scoped(_ source: ImageSource, _ computer: String?) -> String {
        "\(computer ?? "")|\(source)"
    }

    /// `max` only counts where the computer shrinks pictures; nil is the picture whole.
    static func key(_ connection: Connection, _ source: ImageSource, max: Int?) -> String {
        let shrunk = max.flatMap { connection.canShrinkImages ? $0 : nil }
        return scoped(source, connection.active) + (shrunk.map { "@\($0)" } ?? "")
    }

    static func cached(_ key: String) -> UIImage? { decoded.object(forKey: key as NSString) }

    static func failed(_ source: ImageSource, _ connection: Connection) -> Bool {
        refused.contains(scoped(source, connection.active))
    }

    static func load(_ connection: Connection, _ source: ImageSource, max: Int?) async throws -> UIImage {
        let key = key(connection, source, max: max)
        if let known = cached(key) { return known }
        let scope = scoped(source, connection.active)
        let task =
            loading[key]
            ?? Task {
                defer { loading[key] = nil }
                // Only `image` hands a preview's frame out; asked for whole, at the most it shrinks to.
                let url: String
                if case .preview = source {
                    url = try await connection.image(source, max: max ?? largest)
                } else {
                    url = try await connection.image(source, max: max)
                }
                guard let image = await Task.detached(operation: { decode(url) }).value else {
                    throw PairingError("Not an image.")
                }
                let size = image.size
                decoded.setObject(image, forKey: key as NSString, cost: Int(size.width * size.height * image.scale * image.scale * 4))
                return image
            }
        loading[key] = task
        do {
            let image = try await task.value
            refused.remove(scope)
            return image
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            refused.insert(scope)
            throw error
        }
    }

    /// A data URL as a picture, decoded off the main thread; nil if it isn't one.
    nonisolated private static func decode(_ url: String) -> UIImage? {
        guard url.hasPrefix("data:"), let comma = url.firstIndex(of: ",") else { return nil }
        guard let data = Data(base64Encoded: String(url[url.index(after: comma)...]), options: .ignoreUnknownCharacters)
        else { return nil }
        return UIImage(data: data)?.preparingForDisplay()
    }
}

/// Loads a picture once the computer is online and its bridge is known.
struct RemoteImage<Content: View>: View {
    let source: ImageSource
    /// Pixels on its longer side; nil for the picture whole.
    var max: Int?
    @ViewBuilder let content: (LoadedImage) -> Content
    @Environment(Connection.self) private var connection
    @State private var loaded = LoadedImage()

    var body: some View {
        let key = Pictures.key(connection, source, max: max)
        let ready = connection.status.state == .online && connection.overview != nil
        // Held by a view that's always there: content that draws nothing until it loads would never start the load.
        ZStack {
            Color.clear.frame(width: 0, height: 0)
            content(Pictures.cached(key).map { LoadedImage(image: $0) } ?? loaded)
        }
            .task(id: "\(key)|\(ready)") {
                guard Pictures.cached(key) == nil else { return }
                loaded = LoadedImage()
                guard ready else { return }
                do {
                    loaded = LoadedImage(image: try await Pictures.load(connection, source, max: max))
                } catch is CancellationError {
                } catch {
                    loaded = LoadedImage(failed: true)
                }
            }
    }
}
