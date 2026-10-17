import RelayRemote
import SwiftUI

/// One card over the composer: what docks there on the desktop (the goal, a
/// usage limit, stopped and background work, a settled thread), in glass like
/// the composer under it.
struct Strip<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) { content }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(.regular, in: .rect(cornerRadius: 20))
            .padding(.horizontal, 20)
            .padding(.bottom, 6)
    }
}

/// A strip's line: an icon, the head in the foreground and a muted tail, then what it offers.
struct StripLine<Trailing: View>: View {
    let icon: String
    var tint: Color?
    let head: String
    let tail: String
    var lines = 2
    @ViewBuilder var trailing: Trailing
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.footnote)
                .foregroundStyle(tint ?? colors.muted)
                .frame(width: 18)
            // One Text: split into views it can loop layout in a list's row.
            Text("\(head)\(Text(tail).foregroundStyle(colors.muted))")
                .font(.subheadline)
                .foregroundStyle(colors.foreground)
                .lineLimit(lines)
                .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
    }
}

extension StripLine where Trailing == EmptyView {
    init(icon: String, tint: Color? = nil, head: String, tail: String, lines: Int = 2) {
        self.init(icon: icon, tint: tint, head: head, tail: tail, lines: lines) { EmptyView() }
    }
}

/// What an action asks before it goes; it only turns busy once the answer is yes.
struct StripConfirm {
    let title: String
    let message: String
    let yes: String
    var no = "Cancel"
}

/// A small action that stays pressed until its work is done and says when it
/// failed; when only the answer got lost, that it may still go through.
struct StripButton: View {
    let label: String
    var busyLabel: String?
    var failed = "That didn't work"
    var unsure: String?
    var primary = false
    var confirm: StripConfirm?
    let action: () async throws -> Void
    @State private var busy = false
    @State private var asking = false
    @State private var failure: (title: String, message: String)?
    @Environment(\.colors) private var colors

    var body: some View {
        Group {
            if primary {
                Button(busy ? busyLabel ?? label : label) { press() }
                    .buttonStyle(.accentGlass)
            } else {
                Button(busy ? busyLabel ?? label : label) { press() }.buttonStyle(.glass)
            }
        }
        .font(.footnote.weight(.semibold))
        .controlSize(.small)
        .lineLimit(1)
        .fixedSize()
        .disabled(busy)
        .confirmationDialog(confirm?.title ?? "", isPresented: $asking, titleVisibility: .visible) {
            Button(confirm?.yes ?? "", role: .destructive) { go() }
            Button(confirm?.no ?? "Cancel", role: .cancel) {}
        } message: {
            Text(confirm?.message ?? "")
        }
        .alert(failure?.title ?? "", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") {}
        } message: {
            Text(failure?.message ?? "")
        }
    }

    private func press() {
        guard !busy else { return }
        if confirm != nil { asking = true } else { go() }
    }

    private func go() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await action()
            } catch {
                let why = error.localizedDescription
                if let unsure, let call = error as? RemoteCallError, case .unanswered = call {
                    failure = (unsure, "\(why) The request went out, so it may still happen once the computer answers.")
                } else {
                    failure = (failed, why)
                }
            }
        }
    }
}
