import Foundation
import WebKit

@MainActor final class H5ResourceScheme: NSObject, WKURLSchemeHandler {
    private let call: CallCoordinator
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    private let root = Bundle.main.url(forResource: "H5Shell", withExtension: nil)
    init(call: CallCoordinator) { self.call = call }
    static func resourcePath(_ url: URL) -> String? {
        guard url.scheme == "vvoice-h5", url.host == "app", url.user == nil, url.password == nil, url.port == nil else { return nil }
        let path = url.path == "/" ? "index.html" : url.path == "/compare" ? "comparison.html" : String(url.path.dropFirst())
        guard !path.isEmpty, !path.contains(".."), !path.contains("\\"), !path.hasPrefix("/") else { return nil }
        return path
    }
    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, let path = Self.resourcePath(url) else { urlSchemeTask.didFailWithError(CocoaError(.fileReadNoPermission)); return }
        let id = ObjectIdentifier(urlSchemeTask)
        tasks[id] = Task { [weak self] in
            guard let self else { return }
            do {
                let data: Data, mime: String
                if path == "api/comparison" {
                    data = try JSONSerialization.data(withJSONObject: await self.call.api.call("comparison")); mime = "application/json"
                } else if path.hasPrefix("api/comparison/audio/") {
                    guard !self.call.active else { throw CocoaError(.fileReadNoPermission) }
                    let clip = String(path.dropFirst("api/comparison/audio/".count))
                    data = try await self.call.api.comparisonAudio(clip); mime = "audio/wav"
                } else {
                    guard let root, let manifestData = try? Data(contentsOf: root.appendingPathComponent("source-manifest.json")),
                          let manifest = try? JSONSerialization.jsonObject(with: manifestData) as? [String: Any], let outputs = manifest["outputs"] as? [String: String], outputs[path] != nil else { throw CocoaError(.fileReadNoPermission) }
                    data = try Data(contentsOf: root.appendingPathComponent(path))
                    mime = ["html":"text/html","js":"text/javascript","mjs":"text/javascript","css":"text/css","webp":"image/webp","png":"image/png","svg":"image/svg+xml"][URL(fileURLWithPath: path).pathExtension] ?? "application/octet-stream"
                }
                guard !Task.isCancelled, self.tasks[id] != nil else { return }
                let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type":mime + (mime.hasPrefix("text/") ? "; charset=utf-8" : ""),"Content-Length":String(data.count),"Access-Control-Allow-Origin":"*","Cache-Control":"no-store"])!
                urlSchemeTask.didReceive(response); urlSchemeTask.didReceive(data); urlSchemeTask.didFinish(); self.tasks[id] = nil
            } catch {
                guard !Task.isCancelled, self.tasks[id] != nil else { return }; urlSchemeTask.didFailWithError(error); self.tasks[id] = nil
            }
        }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) { tasks.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.cancel() }
}
