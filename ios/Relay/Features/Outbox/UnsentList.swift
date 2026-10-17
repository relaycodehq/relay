import RelayRemote
import SwiftUI

/// What the desktop answers when the thread's worktree is gone; sent again it would only fail again.
private let worktreeUnavailable = "The selected worktree is unavailable. Choose another workspace."

/// Messages the computer didn't take, above the composer: send again, or back into the composer
/// to edit (Android's UnsentStrip). One that came back unanswered may be on the computer already,
/// so Edit asks it first. Ones the lost link stopped go again by themselves once it's back.
struct UnsentList: View {
    let chatId: String
    var rootId: String?
    /// Into the composer; answers how to undo that.
    let restore: (_ text: String, _ images: [PastedImage]) throws -> () -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var busy: Set<String> = []
    @State private var notice: (title: String, message: String)?

    var body: some View {
        let unsent = connection.unsent(chatId, rootId: rootId)
        if !unsent.isEmpty {
            VStack(spacing: 6) {
                ForEach(unsent, id: \.id) { row($0) }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            .animation(.snappy(duration: 0.2), value: unsent.map(\.id))
            .alert(
                notice?.title ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
            ) {
                Button("OK") { notice = nil }
            } message: {
                Text(notice?.message ?? "")
            }
        }
    }

    private func row(_ o: Outgoing) -> some View {
        let working = busy.contains(o.id)
        let waitingForLink = working && o.unsure == true && connection.status.state != .online
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(withoutAgentMention(o.send.body))
                    .font(.subheadline)
                    .foregroundStyle(colors.foreground)
                    .lineLimit(1)
                Text(waitingForLink ? "Connecting…" : (o.unsure == true ? "Maybe not sent: " : "Not sent: ") + (o.error ?? ""))
                    .font(.caption)
                    .foregroundStyle(colors.destructive)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button("Edit") { act(o) { try await edit(o) } }
                .font(.caption.weight(.semibold))
                .foregroundStyle(colors.muted)
                .buttonStyle(.plain)
                .padding(.horizontal, 6)
            if o.error == worktreeUnavailable && connection.canUseProjectFolder {
                outlined("Use project folder") {
                    act(o) {
                        try await connection.useProjectFolder(chatId)
                        connection.retry(o)
                    }
                }
            } else {
                outlined("Try again") { connection.retry(o) }
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 8)
        .background(colors.background, in: .rect(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(colors.destructive.opacity(0.5)) }
        .opacity(working ? 0.5 : 1)
        .disabled(working)
    }

    private func outlined(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(colors.foreground)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(colors.border) }
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func edit(_ o: Outgoing) async throws {
        let name = connection.computer?.name ?? "Your computer"
        if o.unsure == true {
            // Unanswered, it may be on the computer already: sent again it would go twice.
            guard await connection.whenOnline(within: .seconds(20)) else {
                throw PairingError(
                    "\(name) isn't connected yet, so this phone can't tell whether this one arrived. It isn't lost: once connected, the phone checks and it arrives only once.")
            }
            if try await connection.reached(o) {
                await connection.load(chatId)
                notice = ("Your computer received it", "\(name) already accepted this send or is still working on it, so it can't be taken back here.")
                return
            }
        }
        _ = try restore((o.send.side == true ? "/btw " : "") + withoutAgentMention(o.send.body), o.send.images ?? [])
        connection.outbox.drop(o.id)
    }

    private func act(_ o: Outgoing, _ work: @escaping () async throws -> Void) {
        guard !busy.contains(o.id) else { return }
        busy.insert(o.id)
        Task {
            defer { busy.remove(o.id) }
            do { try await work() } catch { notice = ("Couldn't take it back yet", error.localizedDescription) }
        }
    }
}

extension Connection {
    /// True once the computer is reached, false after `within` without it.
    func whenOnline(within: Duration) async -> Bool {
        let until = ContinuousClock.now + within
        while status.state != .online {
            guard ContinuousClock.now < until else { return false }
            try? await Task.sleep(for: .milliseconds(250))
        }
        return true
    }
}
