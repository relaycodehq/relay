import Foundation
import RelayRemote

// The parts of ThreadRow.kt the list's rows read; the sorting is RelayKit's Activity.swift.

func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
