import Foundation
import Testing

@testable import RelayRemote

// Android's HtmlRenderTest: cases from shared/html-render-phone.test.ts and the helpers it leans on.
struct RendersTests {
    let light = RenderTheme(dark: false, vars: ["--text": "#303237"])

    @Test func rulesAndBootstrapComeFirst() {
        let html = phoneRenderDocument("<!doctype html><html><head><title>x</title></head><body>hi</body></html>", theme: light)
        #expect(
            html.range(
                of: #"^<!doctype html><html><head><meta name="viewport"[^>]*><meta http-equiv="Content-Security-Policy"[^>]*><script>[\s\S]*</script><title>x</title>"#,
                options: .regularExpression) != nil)
        #expect(html.contains("ReactNativeWebView.postMessage"))
    }

    @Test func realSizePageScrollsAndZoomsItself() {
        let fitted = phoneRenderDocument("<p>hi</p>", theme: light)
        let real = phoneRenderDocument("<p>hi</p>", theme: light, fit: false)
        #expect(fitted.contains("maximum-scale=1\"") && fitted.contains("html{overflow:hidden}") && fitted.contains("relayRender: \"size\""))
        #expect(!(real.contains("maximum-scale=1\"") || real.contains("overflow:hidden") || real.contains("relayRender: \"size\"")))
        #expect(real.contains("relayRender: \"compose\"") && real.contains("relayRender: \"link\""))
    }

    @Test func addsDoctype() {
        #expect(phoneRenderDocument("<p>hi</p>", theme: light).hasPrefix("<!doctype html><head><meta charset=\"utf-8\">"))
    }

    @Test func cspWithoutSandbox() {
        #expect(!phoneRenderCSP.contains("sandbox"))
        #expect(phoneRenderCSP.contains("default-src 'none'"))
        #expect(!phoneRenderCSP.contains("\""))
    }

    @Test func themeCantBreakOut() {
        let html = phoneRenderDocument(
            "<p>x</p>", theme: RenderTheme(dark: true, vars: ["--text": "</script><script>alert(1)</script>"]))
        #expect(html.components(separatedBy: "</script>").count - 1 == 1)
    }

    @Test func sameThemeSameDocument() {
        // A document that differs reloads the page, so equal themes must write the same one.
        var a: [String: String] = [:], b: [String: String] = [:]
        let names = (1...40).map { "--v\($0)" }
        for name in names { a[name] = "#000" }
        for name in names.reversed() { b[name] = "#000" }
        #expect(phoneRenderDocument("<p>x</p>", theme: RenderTheme(dark: true, vars: a))
            == phoneRenderDocument("<p>x</p>", theme: RenderTheme(dark: true, vars: b)))
    }

    @Test func parsesMessages() {
        #expect(parseRenderMessage(#"{"relayRender":"size","height":120.4}"#) == .size(121))
        #expect(parseRenderMessage(#"{"relayRender":"size","height":41}"#) == .size(41))
        #expect(parseRenderMessage(#"{"relayRender":"size","height":1e9}"#) == .size(renderMaxHeight))
        #expect(
            parseRenderMessage(#"{"relayRender":"link","href":"https://example.com/a"}"#) == .link("https://example.com/a"))
        #expect(parseRenderMessage(#"{"relayRender":"compose","text":"Go with B"}"#) == .compose("Go with B"))
        let long = parseRenderMessage(#"{"relayRender":"compose","text":""# + String(repeating: "x", count: 100_000) + #""}"#)
        #expect(long == .compose(String(repeating: "x", count: renderComposeChars)))
        #expect(parseRenderMessage(#"{"relayRender":"answer","json":"{\"sound\":\"glass\"}"}"#) == .answer(#"{"sound":"glass"}"#))
        #expect(
            parseRenderMessage(#"{"relayRender":"answer","json":""# + String(repeating: "x", count: askAnswerMaxChars + 1) + #""}"#)
                == nil)
        #expect(parseRenderMessage(#"{"relayRender":"answer","json":{"sound":"glass"}}"#) == nil)
    }

    @Test func dropsTheRest() {
        for message in [
            "not json", "null", "\"size\"",
            #"{"relayRender":"size","height":"tall"}"#,
            #"{"relayRender":"size","height":null}"#,
            #"{"relayRender":"link","href":"javascript:alert(1)"}"#,
            #"{"relayRender":"link","href":"intent://x#Intent;end"}"#,
            #"{"relayRender":"link","href":"tel:112"}"#,
            #"{"relayRender":"compose","text":"   "}"#,
            #"{"relayRender":"other"}"#,
        ] {
            #expect(parseRenderMessage(message) == nil, "\(message)")
        }
    }

    @Test func heights() {
        let heights: [Double] = [900, 700, 600, 500, 400, 300]
        #expect(renderHeightAt(heights, width: 300) == 900)
        #expect(renderHeightAt(heights, width: 400) == 800)
        #expect(renderHeightAt(heights, width: 2000) == 300)
        #expect(renderHeightAt([1], width: 400) == nil)
        #expect(clampRenderHeight(3) == renderMinHeight)
    }

    @Test func composes() {
        #expect(composeInto("", "a") == "a")
        #expect(composeInto("hi  ", "a") == "hi\n\na")
        #expect(composeInto("pick 1 now", "2", earlier: "1") == "pick 2 now")
    }
}
