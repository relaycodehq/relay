import Foundation

/// `shared/remote-batches.ts`: byte budgets, without an attachment-count limit.
enum MessageBatches {
    static let chunkBytes = 3 * 1024 * 1024
    static let maxBytes = 128 * 1024 * 1024

    static func allows(_ method: String, _ args: JSON) -> Bool {
        method == "sendDraft" || (method == "desktop" && args.array?.first?.string == "sendProjectChat")
    }
}
