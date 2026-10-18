import Darwin
import Foundation

/// What took the last run down: a line for the page, the whole trace to copy.
struct Crash: Identifiable {
    let id = UUID()
    let summary: String
    let details: String
}

/// Android's CrashRecovery as far as iOS allows. An app can't open itself again after a crash,
/// so the crash is written down as the app goes, and the next launch opens on `CrashScreen`
/// with it instead of the user being left wondering why Relay vanished.
enum CrashRecovery {
    private static let file = URL.cachesDirectory.appending(path: "last-crash.txt")
    private static let signals = [SIGABRT: "ABRT", SIGBUS: "BUS", SIGFPE: "FPE", SIGILL: "ILL", SIGSEGV: "SEGV", SIGTRAP: "TRAP"]

    /// Before anything else runs, so a crash while launching is caught too.
    static func install() {
        prepareHandler(path: file.path(percentEncoded: false), names: signals)
        // An Objective-C exception names what went wrong; the abort after it adds the trace.
        NSSetUncaughtExceptionHandler { exception in
            let text = "exception \(exception.name.rawValue): \(exception.reason ?? "")\n"
            try? Data(text.utf8).write(to: CrashRecovery.file)
        }
        for signal in signals.keys {
            var action = sigaction()
            action.__sigaction_u.__sa_handler = { crashed($0) }
            sigemptyset(&action.sa_mask)
            sigaction(signal, &action, nil)
        }
    }

    /// The crash this launch comes back from, once: read, it's gone.
    static func take() -> Crash? {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return nil }
        try? FileManager.default.removeItem(at: file)
        return Crash(summary: summary(text), details: text)
    }

    /// The exception's name and reason, or the signal and the first of Relay's own frames under it.
    static func summary(_ text: String) -> String {
        let lines = text.split(separator: "\n").map(String.init)
        if let exception = lines.first(where: { $0.hasPrefix("exception ") }) {
            return String(exception.dropFirst("exception ".count).prefix(300))
        }
        let signal = lines.first { $0.hasPrefix("signal ") }.map { String($0.dropFirst("signal ".count)) } ?? "A crash"
        // The frames above the signal trampoline are this file's handler.
        let below = lines.drop { !$0.contains("_sigtramp") }.dropFirst()
        let frame = (below.isEmpty ? lines[...] : below).lazy.compactMap(relayFrame).first
        return frame.map { "\(signal) in \($0)" } ?? signal
    }

    /// `6  Relay.debug.dylib  0x… $s5Relay9CrashTestO4boomyySiSgFZ + 204` → `CrashTest.boom(Optional<Int>)`.
    private static func relayFrame(_ line: String) -> String? {
        let parts = line.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count >= 4, parts[1] == "Relay" || parts[1].hasPrefix("Relay.") else { return nil }
        var name = demangle(String(parts[3]))
        for cut in [" -> ", " : "] {
            if let at = name.range(of: cut) { name = String(name[..<at.lowerBound]) }
        }
        for noise in ["static ", "Swift.", "Relay."] { name = name.replacingOccurrences(of: noise, with: "") }
        return String(name.prefix(160))
    }

    private static func demangle(_ symbol: String) -> String {
        typealias Demangle = @convention(c) (UnsafePointer<CChar>?, Int, UnsafeMutablePointer<CChar>?, UnsafeMutablePointer<Int>?, UInt32) -> UnsafeMutablePointer<CChar>?
        guard let found = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "swift_demangle") else { return symbol }
        let call = unsafeBitCast(found, to: Demangle.self)
        guard let out = symbol.withCString({ call($0, strlen($0), nil, nil, 0) }) else { return symbol }
        defer { free(out) }
        return String(cString: out)
    }
}

/// Made before the handlers go in: a signal handler can't allocate.
nonisolated(unsafe) private var crashPath: UnsafeMutablePointer<CChar>?
nonisolated(unsafe) private var signalLines = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>.allocate(capacity: Int(NSIG))
nonisolated(unsafe) private var frames = UnsafeMutablePointer<UnsafeMutableRawPointer?>.allocate(capacity: 64)

private func prepareHandler(path: String, names: [Int32: String]) {
    crashPath = strdup(path)
    signalLines.initialize(repeating: nil, count: Int(NSIG))
    for (signal, name) in names { signalLines[Int(signal)] = strdup("signal SIG\(name)\n") }
}

/// Only async-signal-safe calls, bar the trace, which crash reporters take the same way.
private func crashed(_ signal: Int32) {
    if let crashPath {
        let fd = open(crashPath, O_WRONLY | O_CREAT | O_APPEND, 0o644)
        if fd >= 0 {
            if let line = signalLines[Int(signal)] { write(fd, line, strlen(line)) }
            backtrace_symbols_fd(frames, backtrace(frames, 64), fd)
            close(fd)
        }
    }
    // The system's own crash report and exit still happen.
    Darwin.signal(signal, SIG_DFL)
    raise(signal)
}
