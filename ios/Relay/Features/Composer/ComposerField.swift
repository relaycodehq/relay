import RelayRemote
import SwiftUI

/// What's typed into a composer, and what the rest of it needs to know about that: whether
/// there's anything to send and whether the command menu is wanted. Those change far less often
/// than the text, so a letter typed runs the field again, not the whole composer with its menus.
@Observable
final class ComposerText {
    var text = "" {
        didSet { if text != oldValue { summarize() } }
    }
    /// Here rather than in the composer's state: the field moves it with every letter, and only
    /// the field shows it.
    var cursor: SwiftUI.TextSelection?
    private(set) var isEmpty = true
    /// Nothing but whitespace.
    private(set) var blank = true
    /// The text while it could open the command menu; nil otherwise.
    private(set) var menuText: String?
    /// Starts with a command, or ends in a `$skill` being typed: the agent's commands are wanted.
    private(set) var wantsCommands = false

    private func summarize() {
        let empty = text.isEmpty
        if isEmpty != empty { isEmpty = empty }
        let blank = text.allSatisfy(\.isWhitespace)
        if self.blank != blank { self.blank = blank }
        let menu = commandTrigger(text) != nil ? text : nil
        if menuText != menu { menuText = menu }
        let wants =
            text.range(of: "^\\s*[/$]", options: .regularExpression) != nil
            || text.range(of: "\\s\\$\\S*$", options: .regularExpression) != nil
        if wantsCommands != wants { wantsCommands = wants }
    }
}

/// The composer's text field, the one part of it each letter runs again.
struct ComposerField: View {
    let field: ComposerText
    let prompt: String
    let focused: FocusState<Bool>.Binding
    /// After every change, typed or put in.
    let changed: (String) -> Void

    var body: some View {
        @Bindable var field = field
        TextField(prompt, text: $field.text, selection: $field.cursor, axis: .vertical)
            .lineLimit(1...8)
            .focused(focused)
            .onChange(of: field.text) { _, now in changed(now) }
    }
}
