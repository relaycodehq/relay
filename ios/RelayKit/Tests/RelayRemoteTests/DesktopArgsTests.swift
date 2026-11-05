import Testing

@testable import RelayRemote

@Suite struct DesktopArgsTests {
    let thread: JSON = .string("t1")

    @Test func aNullTheDesktopTakesGoesSoAThreadCanMoveBackToTheProjectFolder() {
        // electron/api/chats.ts: selectAgentWorktree's path is nullable but not optional; left out, it's refused.
        let sent = RemoteClient.desktopArgs("selectAgentWorktree", [thread, .null], bridge: Bridge.workspace)
        #expect(sent == .array([thread, .null]))
    }

    @Test func leftOutArgumentsAtTheEndGoAndOnesInBetweenGoAsNull() {
        let args: [JSON?] = [thread, Optional<JSON>.none, .bool(true), Optional<JSON>.none, Optional<JSON>.none]
        let sent = RemoteClient.desktopArgs("rewindProjectTurn", args, bridge: Bridge.workspace)
        #expect(sent == .array([thread, .null, .bool(true)]))
    }
}
