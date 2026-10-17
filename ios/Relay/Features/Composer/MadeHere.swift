/// A thread made on this phone: where, and what it's called until the computer says.
struct Made {
    let id: String
    let projectId: String
    let title: String
}

/// Threads made on this phone, for their screen to open on a title and a composer:
/// the computer lists a thread only once its first message is in.
@MainActor
enum MadeHere {
    private static var made: [String: Made] = [:]

    static func add(_ chat: Made) { made[chat.id] = chat }
    static func of(_ id: String) -> Made? { made[id] }
}
