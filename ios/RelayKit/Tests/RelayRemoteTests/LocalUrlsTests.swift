import Testing

@testable import RelayRemote

// The Android app's LocalUrlsTest.
struct LocalUrlsTests {
    @Test func takesTheLinksAgentsWriteToTheirOwnComputer() {
        #expect(LocalUrls.link("http://localhost:5177/previews/x/") == SiteAddress(port: 5177, path: "/previews/x/"))
        #expect(LocalUrls.link("http://127.0.0.1:3000?a=1#b") == SiteAddress(port: 3000, path: "/?a=1#b"))
        #expect(LocalUrls.link("HTTP://LOCALHOST:8080") == SiteAddress(port: 8080))
        #expect(LocalUrls.link("http://[::1]:5173/x") == SiteAddress(port: 5173, path: "/x"))
        #expect(LocalUrls.link("http://0.0.0.0:4321/") == SiteAddress(port: 4321))
        #expect(LocalUrls.link("http://localhost/") == SiteAddress(port: 80))
        // A dev certificate can't pass, and other hosts aren't the computer's.
        #expect(LocalUrls.link("https://localhost:5177/") == nil)
        #expect(LocalUrls.link("http://localhost.example.com:5177/") == nil)
        #expect(LocalUrls.link("http://192.168.1.5:5177/") == nil)
        #expect(LocalUrls.link("http://localhost:70000/") == nil)
        #expect(LocalUrls.link("http://localhost:5177/a b") == nil)
    }

    @Test func readsWhatSomeoneTypesInTheAddressBar() {
        #expect(LocalUrls.typed("5173") == SiteAddress(port: 5173))
        #expect(LocalUrls.typed(" :5173/api ") == SiteAddress(port: 5173, path: "/api"))
        #expect(LocalUrls.typed("localhost:3000/x") == SiteAddress(port: 3000, path: "/x"))
        #expect(LocalUrls.typed("127.0.0.1:3000") == SiteAddress(port: 3000))
        #expect(LocalUrls.typed("http://localhost:3000/") == SiteAddress(port: 3000))
        #expect(LocalUrls.typed("") == nil)
        #expect(LocalUrls.typed("0") == nil)
        #expect(LocalUrls.typed("example.com") == nil)
        #expect(LocalUrls.typed("vite") == nil)
    }

    @Test func keepsTheDesktopsPortWhereTheSystemLetsAnAppTakeIt() {
        #expect(LocalUrls.preferredPort(5177) == 5177)
        #expect(LocalUrls.preferredPort(1024) == 1024)
        #expect(LocalUrls.preferredPort(80) == 0)
        #expect(LocalUrls.preferredPort(443) == 0)
    }

    @Test func loadsTheDesktopsOwnOriginWhenThePortIsTheSameAndMapsBack() {
        let page = SiteAddress(port: 5177, path: "/previews/x/")
        #expect(LocalUrls.local(page, localPort: 5177) == "http://localhost:5177/previews/x/")
        #expect(LocalUrls.local(page, localPort: 41000) == "http://127.0.0.1:41000/previews/x/")
        let ports = [5177: 5177, 41000: 80]
        #expect(LocalUrls.desktop("http://localhost:5177/previews/x/") { ports[$0] } == page)
        #expect(LocalUrls.desktop("http://127.0.0.1:41000/login") { ports[$0] } == SiteAddress(port: 80, path: "/login"))
        #expect(LocalUrls.desktop("http://localhost:3000/") { ports[$0] } == nil)
        #expect(page.shown == "localhost:5177/previews/x/")
        #expect(SiteAddress(port: 80).shown == "localhost:80")
    }
}
