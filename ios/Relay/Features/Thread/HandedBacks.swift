import RelayRemote

/// A queued reply taken back on the main screen, bound for its side conversation's composer
/// (Android's HandedBacks). Still queued on the computer: the screen that restores it takes it out.
@MainActor
enum HandedBacks {
    private static var waiting: [String: RemoteQueued] = [:]

    static func hand(_ draftKey: String, _ item: RemoteQueued) { waiting[draftKey] = item }

    static func take(_ draftKey: String) -> RemoteQueued? { waiting.removeValue(forKey: draftKey) }
}
