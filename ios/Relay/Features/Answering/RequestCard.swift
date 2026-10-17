import RelayRemote
import SwiftUI

/// What the running turn waits on: an approval or the agent's questions. It
/// takes the composer's place until answered; the rest wait their turn.
struct RequestCard: View {
    let chatId: String
    let request: AgentRequest
    /// How many more wait after this one.
    let more: Int
    @Environment(Connection.self) private var connection
    @State private var busy = false
    @State private var error: String?

    private var decisions: [String] { (request.decisions ?? []).compactMap(\.string) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            switch request.kind {
            case "question" where !(request.questions ?? []).isEmpty:
                Questions(questions: request.questions ?? [], busy: busy) { answers in
                    respond(.answers(answers))
                }
            case "page":
                Text(request.title).font(.headline)
                if let page = request.page, connection.canRender {
                    AskPage(chatId: chatId, page: page, busy: busy, share: 0.5) { respond(.page($0)) }
                } else {
                    Text("This one needs the page Relay shows on your computer.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            default:
                approval
            }
            if more > 0 {
                Text(more == 1 ? "1 more waiting after this" : "\(more) more waiting after this")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
        .sensoryFeedback(.success, trigger: busy) { was, now in was && !now && error == nil }
    }

    private var approval: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(request.title)
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
            if let note = request.note, !note.isEmpty {
                Text(note).font(.subheadline).foregroundStyle(.secondary)
            }
            if let detail = request.detail, !detail.isEmpty {
                ScrollView {
                    Text(detail)
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 160)
                .fixedSize(horizontal: false, vertical: true)
                .padding(10)
                .background(.quietFill, in: .rect(cornerRadius: 12))
            }
            HStack(spacing: 8) {
                if decisions.contains("cancel") {
                    Menu("More", systemImage: "ellipsis") {
                        Button("Stop the answer", systemImage: "stop", role: .destructive) { respond(.decision("cancel")) }
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
                }
                Spacer()
                if decisions.contains("decline") {
                    Button("Decline") { respond(.decision("decline")) }.buttonStyle(.glass)
                }
                if decisions.contains("acceptForSession") {
                    Button("Always") { respond(.decision("acceptForSession")) }.buttonStyle(.glass)
                }
                if decisions.contains("accept") {
                    Button(decisions.contains("acceptForSession") ? "Once" : "Approve") { respond(.decision("accept")) }
                        .buttonStyle(.glassProminent)
                }
            }
            .lineLimit(1)
            .fixedSize()
            .frame(maxWidth: .infinity, alignment: .trailing)
            .controlSize(.large)
            .disabled(busy)
        }
    }

    private func respond(_ response: AgentResponse) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await connection.respond(chatId, request: request.id, response)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
