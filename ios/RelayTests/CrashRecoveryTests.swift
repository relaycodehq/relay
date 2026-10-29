import Testing

@testable import Relay

// The line the crash screen shows, from what the signal handler wrote.
struct CrashRecoveryTests {
    /// A real dictation crash on an iPhone, where the system's frames print as <redacted>.
    @Test func namesTheFrameThatCrashedNotTheHandler() {
        let written = """
            signal SIGTRAP
            0   Relay                               0x0000000102b4c1a0 $s5Relay7crashed33_A116FD42CA09723EEF29F77E0C4366CFLLyys5Int32VF + 80
            1   Relay                               0x0000000102b4c0f4 $s5Relay13CrashRecoveryO7installyyFZys5Int32VcfU0_To + 20
            2   libsystem_platform.dylib            0x00000001f2a1b0c8 <redacted> + 56
            3   libdispatch.dylib                   0x00000001b6b2a648 <redacted> + 120
            4   libswift_Concurrency.dylib          0x00000001c0e2d4a0 <redacted> + 48
            5   Relay                               0x0000000102a91e2c $s5Relay10MicrophoneC5start11interruptedScSySdGyyc_tKFySo16AVAudioPCMBufferC_So0E4TimeCtYbcfU0_ + 108
            """
        #expect(CrashRecovery.summary(written) == "SIGTRAP in closure #2 in Microphone.start(interrupted:)")
    }

    @Test func shortensSymbolsAsSwiftsSimplifiedDemangling() {
        #expect(FrameName.simplified("static Relay.CrashTest.boom(Swift.Int?) -> ()") == "CrashTest.boom(_:)")
        #expect(FrameName.simplified("Relay.Feed.rows.getter : [Swift.String : Swift.Int]") == "Feed.rows.getter")
        #expect(FrameName.simplified("closure #1 in Relay.Feed.handler.getter : () -> ()") == "closure #1 in Feed.handler.getter")
        #expect(
            FrameName.simplified("closure #1 () -> () in closure #3 (Swift.Int) -> () in Relay.A.b(x: [Swift.Int], _: (Swift.Int) -> ()) -> ()")
                == "closure #1 in closure #3 in A.b(x:_:)")
    }
}
