import Synchronization
import Testing

@testable import RelayRemote

// The Android app's TunnelPortsTest.
struct TunnelPortsTests {
    final class Memory: TunnelPorts.Storage {
        let texts = Mutex<[String: String]>([:])
        func read(_ computer: String) -> String? { texts.withLock { $0[computer] } }
        func write(_ computer: String, _ text: String) { texts.withLock { $0[computer] = text } }
        func computers() -> Set<String> { texts.withLock { Set($0.keys) } }
        func remove(_ computer: String) { texts.withLock { $0[computer] = nil } }
        subscript(_ computer: String) -> String? { read(computer) }
    }

    @Test func opensWhatSitesListsAndWhatWasTypedAndAsksForTheRest() {
        let ports = TunnelPorts(storage: Memory())
        ports.sawSites([5177], on: "a")
        #expect(ports.allows(5177, on: "a"))
        #expect(!ports.allows(6379, on: "a"))
        ports.type(6379, on: "a")
        #expect(ports.allows(6379, on: "a"))
        // A site that stopped listening isn't open any more; a typed port stays.
        ports.sawSites([], on: "a")
        #expect(!ports.allows(5177, on: "a"))
        #expect(ports.allows(6379, on: "a"))
    }

    @Test func oneComputersSitesAndTypedPortsDontOpenAnothers() {
        let ports = TunnelPorts(storage: Memory())
        ports.sawSites([5173], on: "a")
        ports.type(8080, on: "a")
        #expect(!ports.allows(5173, on: "b"))
        #expect(!ports.allows(8080, on: "b"))
        #expect(ports.typedPorts(on: "b").isEmpty)
    }

    @Test func keepsTypedPortsAcrossLaunchesPerComputer() {
        let memory = Memory()
        let first = TunnelPorts(storage: memory)
        first.type(3000, on: "a")
        first.type(8080, on: "a")
        first.type(9000, on: "b")
        #expect(memory["a"] == "3000,8080")
        let again = TunnelPorts(storage: memory)
        #expect(again.typedPorts(on: "a") == [3000, 8080])
        #expect(again.isTyped(9000, on: "b"))
        #expect(!again.isTyped(8080, on: "b"))
    }

    @Test func forgetsThePortsOfComputersNoLongerPaired() {
        let memory = Memory()
        let ports = TunnelPorts(storage: memory)
        ports.type(3000, on: "a")
        ports.type(9000, on: "b")
        ports.sawSites([5173], on: "b")
        ports.keepOnly(["a"])
        #expect(memory["b"] == nil)
        #expect(!ports.allows(9000, on: "b"))
        #expect(!ports.allows(5173, on: "b"))
        #expect(ports.allows(3000, on: "a"))
    }
}
