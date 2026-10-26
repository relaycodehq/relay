import RelayRemote
import SwiftUI

/// A row's words as one `Text`, so a long one wraps like a sentence: the verb muted, what it
/// acted on bright in chips. One `Text` also keeps clear of the layout loop a row split into views
/// set off under a pushed screen (ios/AGENTS.md).
struct RowWords {
    let colors: RelayColors
    private(set) var text = Text(verbatim: "")
    private var chips = 0

    init(colors: RelayColors) {
        self.colors = colors
    }

    mutating func say(_ words: String, failed: Bool = false) {
        add(Text(verbatim: words).foregroundStyle(failed ? colors.destructive : colors.muted))
    }

    /// A running row's verb, which the band crosses.
    mutating func sayShining(_ words: String) {
        add(Text(verbatim: words).foregroundStyle(colors.muted).customAttribute(Shining()))
    }

    /// Words that follow on, quieter than the verb: "and ran it".
    mutating func aside(_ words: String) {
        add(Text(verbatim: words).foregroundStyle(colors.faint))
    }

    mutating func plain(_ words: String) {
        add(Text(verbatim: words).foregroundStyle(colors.foreground))
    }

    /// `agent-host/`read-only-bash.ts, with the lines it read dimmed after.
    mutating func file(_ path: String, lines: [String]? = nil) {
        let folder = parentName(path)
        var name = Text(verbatim: baseName(path)).foregroundStyle(colors.foreground)
        if !folder.isEmpty { name = Text("\(Text(verbatim: folder + "/").foregroundStyle(colors.muted))\(name)") }
        if let lines, !lines.isEmpty {
            name = Text("\(name)\(Text(verbatim: " L" + lines.joined(separator: ", ")).foregroundStyle(colors.muted))")
        }
        chip(name)
    }

    /// A pattern, program or hash.
    mutating func code(_ code: String) {
        chip(Text(verbatim: code).foregroundStyle(colors.foreground))
    }

    /// Where a search looked, when it's a folder rather than one file.
    mutating func place(_ place: String) {
        add(Text(verbatim: place).font(.mono(.caption)).foregroundStyle(colors.muted))
    }

    mutating func mark(_ symbol: String, _ color: Color) {
        add(Text(verbatim: " "))
        add(Text(Image(systemName: symbol)).font(.caption2.weight(.semibold)).foregroundStyle(color))
    }

    private mutating func chip(_ content: Text) {
        // Thin spaces inside the box pad it without moving the words around it.
        let padded = Text("\(Text(verbatim: "\u{2009}"))\(content)\(Text(verbatim: "\u{2009}"))")
        add(padded.font(.mono(.caption)).customAttribute(Chip(id: chips)))
        chips += 1
    }

    private mutating func add(_ piece: Text) {
        text = Text("\(text)\(piece)")
    }
}

/// Marks the runs of one chip, which `ChipBoxes` draws a box behind.
nonisolated struct Chip: TextAttribute {
    let id: Int
}

/// Draws each chip's rounded box behind its text, a box per line when a chip wraps, and the band
/// across a running row's verb.
nonisolated struct ChipBoxes: TextRenderer {
    let fill: Color
    var shine: ShineBand?

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            var boxes: [Int: CGRect] = [:]
            for run in line {
                guard let chip = run[Chip.self] else { continue }
                let bounds = run.typographicBounds.rect
                boxes[chip.id] = boxes[chip.id]?.union(bounds) ?? bounds
            }
            for box in boxes.values {
                context.fill(Path(roundedRect: box.insetBy(dx: 0, dy: -1.5), cornerRadius: 4), with: .color(fill))
            }
            guard let shine else {
                context.draw(line)
                continue
            }
            for run in line {
                if run[Shining.self] != nil { shine.draw(run, in: &context) } else { context.draw(run) }
            }
        }
    }
}

extension RowWords {
    /// What one row did, in the past tense or, while it runs, the present.
    mutating func tell(_ row: TraceRow) {
        let live = rowRunning(row)
        let failed = rowFailed(row)
        if live { sayShining(actionVerb(row, live: true)) } else { say(actionVerb(row), failed: failed) }
        switch row.action {
        case .test(let target, _):
            if let target {
                say(" ")
                file(target)
            }
            outcome(row, live: live)
        case .check:
            outcome(row, live: live)
        case .commit(let hash, let subject):
            if let hash {
                say(" ")
                code(String(hash.prefix(7)))
            }
            if !subject.isEmpty { plain(" " + subject) }
        case .web(let query):
            plain(" " + query)
        default:
            say(" ")
            object(row, withPlace: true)
        }
        if row.ranToo { aside(" and ran it") }
    }

    /// Two rows one verb carries: "Read a.ts and b.ts"; two searches of one place say it once.
    mutating func tell(_ a: TraceRow, and b: TraceRow) {
        let sharedPlace = searchPlace(a) != nil && searchPlace(a) == searchPlace(b) ? searchPlace(a) : nil
        say(actionVerb(a) + " ")
        object(a, withPlace: sharedPlace == nil)
        say(" and ")
        object(b, withPlace: sharedPlace == nil)
        if let sharedPlace { searched(in: sharedPlace) }
        if a.ranToo { aside(" and ran them") }
    }

    /// What follows the verb: its file, pattern or program.
    private mutating func object(_ row: TraceRow, withPlace: Bool) {
        switch row.action {
        case .read(let file, _): self.file(file, lines: row.lines)
        case .image(let file), .edit(let file), .create(let file): self.file(file)
        case .search(let pattern, let place):
            code(shortPattern(pattern))
            if withPlace, let place { searched(in: place) }
        case .run(let what), .git(let what): code(what)
        case .web(let query): plain(query)
        default: break
        }
    }

    private mutating func searched(in place: String) {
        say(" in ")
        if searchedOneFile(place) { file(place) } else { self.place(shortWhere(place)) }
    }

    /// A finished test or check says how it went beside its verb; one stopped first says nothing more.
    private mutating func outcome(_ row: TraceRow, live: Bool) {
        if rowFailed(row) {
            mark("xmark", colors.destructive)
        } else if !live, !verdictStopped(row) {
            mark("checkmark", colors.additionText)
        }
    }

    private func searchPlace(_ row: TraceRow) -> String? {
        if case .search(_, let place) = row.action { place } else { nil }
    }
}

/// The SF Symbol a row of this action leads with.
func actionSymbol(_ action: CallAction) -> String {
    switch action {
    case .read: "doc.text"
    case .image: "photo"
    case .search: "magnifyingglass"
    case .web: "globe"
    case .edit: "pencil"
    case .create: "doc.badge.plus"
    case .test: "flask"
    case .check: "checkmark.seal"
    case .commit, .git: "circle.and.line.horizontal"
    case .run: "terminal"
    case .tool: "wrench"
    }
}

/// The symbol a branch's heading leads with.
func branchSymbol(_ kind: BranchKind) -> String {
    switch kind {
    case .read: "doc.text"
    case .search: "magnifyingglass"
    case .web: "globe"
    case .edit: "pencil"
    case .run: "terminal"
    case .check: "flask"
    case .commit, .git: "circle.and.line.horizontal"
    case .tool: "wrench"
    }
}
