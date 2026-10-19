import RelayRemote
import SwiftUI
import Testing
import UIKit

@testable import Relay

@MainActor
struct TurnTraceLayoutTests {
    private func message(_ stage: Int, status: String = "streaming") throws -> ChatMessage {
        func call(_ n: Int) -> JSON {
            let id = "call-\(n)"
            return [
                "kind": "activity", "id": .string(id),
                "activity": ["id": .string(id), "kind": "read", "label": .string("Sources/File\(n).swift"), "status": "complete"],
            ]
        }
        var trace = (0..<12).map(call)
        if stage >= 1 { trace.append(["kind": "commentary", "id": "words", "text": "Checking the next file."]) }
        if stage >= 2 { trace.append(call(12)) }
        return try JSON.object([
            "id": "trace-layout", "role": "assistant", "provider": "codex", "body": "",
            "status": .string(status), "created": .number(Double(Int64(Date().timeIntervalSince1970 * 1000) - 10_000)),
            "version": 1, "trace": .array(trace),
        ]).decode()
    }

    private func content(_ message: ChatMessage, connection: Connection) -> some View {
        TurnTrace(chatId: "", message: message, root: nil, startsOpen: true)
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(connection)
            .environment(\.colors, .relayDark)
            .preferredColorScheme(.dark)
            .background(RelayColors.relayDark.background)
    }

    private func measure<Content: View>(_ host: UIHostingController<Content>, window: UIWindow, label: String) throws -> CGFloat {
        let size = host.sizeThatFits(in: CGSize(width: 390, height: 4000))
        window.frame = CGRect(origin: .zero, size: size)
        host.view.frame = window.bounds
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let path = URL.temporaryDirectory.appending(path: "relay-trace-\(label)-\(Int(size.height)).png")
        try #require(image.pngData()).write(to: path)
        print("Trace layout \(label): \(size.height)pt; \(path.path)")
        return size.height
    }

    @Test func liveRunStaysCompactAcrossCommentaryAndAnotherCall() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let host = UIHostingController(rootView: content(try message(0), connection: fixture.connection))
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 900))
            window.rootViewController = host
            window.makeKeyAndVisible()
            defer {
                window.isHidden = true
                window.rootViewController = nil
            }
            await Task.yield()
            let initial = try measure(host, window: window, label: "calls")
            host.rootView = content(try message(1), connection: fixture.connection)
            let commentary = try measure(host, window: window, label: "commentary")
            host.rootView = content(try message(2), connection: fixture.connection)
            let nextCall = try measure(host, window: window, label: "next-call")
            // A short commentary and the next row need room; twelve old rows don't.
            #expect(commentary < initial + 100)
            #expect(abs(nextCall - commentary) < 100)
            host.rootView = content(try message(1, status: "complete"), connection: fixture.connection)
            let completed = try measure(host, window: window, label: "completed")
            #expect(completed > commentary + 100)
            await Task.yield()
        }
    }
}
