import RelayRemote
import SwiftUI

/// An agent's questions, one at a time, as on Android and the desktop: tap
/// an option, or write your own. `deferred` holds everything until Send, for
/// questions the agent keeps working through; otherwise a single choice goes
/// on by itself.
struct Questions: View {
    let questions: [AgentQuestion]
    var deferred = false
    let busy: Bool
    let send: ([String: [String]]) -> Void

    @State private var at = 0
    @State private var answers: [String: [String]] = [:]
    @State private var typed: [String: String] = [:]
    @State private var advancing: Task<Void, Never>?

    private var question: AgentQuestion { questions[min(at, questions.count - 1)] }
    private var last: Bool { at >= questions.count - 1 }
    private var answered: Bool { !(answers[question.id] ?? []).allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text((question.header ?? "Question").uppercased())
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if questions.count > 1 {
                    Text("\(at + 1) of \(questions.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
            Text(question.question)
                .font(.body.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
            if let options = question.options, !options.isEmpty {
                VStack(spacing: 0) {
                    ForEach(options, id: \.label) { option in
                        OptionRow(option: option, picked: picks.contains(option.label), multiple: question.multiple == true) {
                            pick(option.label)
                        }
                        if option.label != options.last?.label { Divider().padding(.leading, 36) }
                    }
                }
            }
            field
            if showsNext {
                Button(last ? "Send answer" : "Next") { next() }
                    .buttonStyle(.glassProminent)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .disabled(!answered || busy)
            }
        }
        .disabled(busy)
        .animation(.easeOut(duration: 0.15), value: at)
    }

    private var picks: [String] { typed[question.id]?.isEmpty == false ? [] : answers[question.id] ?? [] }

    private var showsNext: Bool {
        deferred || question.multiple == true || (question.options ?? []).isEmpty || typed[question.id]?.isEmpty == false
    }

    @ViewBuilder private var field: some View {
        let prompt = (question.options ?? []).isEmpty ? "Your answer…" : "Or write your own answer…"
        let text = Binding(
            get: { typed[question.id] ?? "" },
            set: { value in
                typed[question.id] = value
                answers[question.id] = value.isEmpty ? [] : [value]
            })
        Group {
            if question.isSecret == true {
                SecureField(prompt, text: text)
            } else {
                TextField(prompt, text: text, axis: .vertical).lineLimit(1...5)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(.quietFill, in: .rect(cornerRadius: 12))
    }

    private func pick(_ label: String) {
        typed[question.id] = nil
        var chosen = answers[question.id] ?? []
        if question.multiple == true {
            if let i = chosen.firstIndex(of: label) { chosen.remove(at: i) } else { chosen.append(label) }
            answers[question.id] = chosen
            return
        }
        answers[question.id] = [label]
        guard !deferred else { return }
        // A moment to see the tick before it goes.
        advancing?.cancel()
        advancing = Task {
            try? await Task.sleep(for: .milliseconds(200))
            if !Task.isCancelled { next() }
        }
    }

    private func next() {
        if last { send(answers) } else { at += 1 }
    }
}

private struct OptionRow: View {
    let option: QuestionOption
    let picked: Bool
    let multiple: Bool
    let tap: () -> Void

    var body: some View {
        Button(action: tap) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: picked ? (multiple ? "checkmark.square.fill" : "checkmark.circle.fill") : (multiple ? "square" : "circle"))
                    .foregroundStyle(picked ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.label)
                    if let description = option.description, !description.isEmpty {
                        Text(description).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 9)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: picked)
        .accessibilityAddTraits(picked ? .isSelected : [])
    }
}
