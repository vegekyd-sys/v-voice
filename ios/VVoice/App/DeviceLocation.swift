import Foundation
@preconcurrency import CoreLocation

struct DeviceLocationResult: Sendable {
    var reason: String?
    var latitude: Double = 0
    var longitude: Double = 0
    var horizontalAccuracyM: Double = 0
    var capturedAt: Date = .distantPast
    var reducedAccuracy = false
    var wire: [String: Any] {
        if let reason { return ["ok": false, "reason": reason] }
        return ["ok": true, "source": "core_location", "latitude": latitude, "longitude": longitude,
                "horizontalAccuracyM": horizontalAccuracyM, "capturedAt": capturedAt.timeIntervalSince1970 * 1000,
                "coordinateSystem": "WGS84", "accuracyAuthorization": reducedAccuracy ? "reduced" : "full"]
    }
    static func reading(_ location: CLLocation, reduced: Bool, now: Date = Date()) -> Self? {
        let age = now.timeIntervalSince(location.timestamp)
        guard CLLocationCoordinate2DIsValid(location.coordinate), location.horizontalAccuracy.isFinite,
              location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 100_000, age >= -5, age <= 30 else { return nil }
        return .init(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
                     horizontalAccuracyM: location.horizontalAccuracy, capturedAt: location.timestamp, reducedAccuracy: reduced)
    }
}

@MainActor protocol DeviceLocationProviding {
    func locate(foreground: Bool, liveActivity: Bool) async -> DeviceLocationResult
    func cancel()
}

/// No continuous tracking, persisted coordinates or Always authorization.
/// The call coordinator owns cancellation and never delegates this to WKWebView.
@MainActor final class DeviceLocation: NSObject, DeviceLocationProviding, @preconcurrency CLLocationManagerDelegate {
    static var declaration: [String: Any] {
        let status: String
        switch CLLocationManager().authorizationStatus {
        case .denied, .restricted: status = "denied"
        case .authorizedAlways, .authorizedWhenInUse: status = "available"
        default: status = "prompt"
        }
        return ["version": 1, "capabilities": ["location.current": ["status": status]]]
    }
    private let manager = CLLocationManager()
    private var waiting: CheckedContinuation<DeviceLocationResult, Never>?
    private var timeout: Task<Void, Never>?
    private var requestID: UUID?
    private var requestStarted = false
    override init() { super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyBest }
    func locate(foreground: Bool, liveActivity: Bool) async -> DeviceLocationResult {
        guard waiting == nil else { return .init(reason: "unavailable") }
        let id = UUID()
        let servicesEnabled = await Task.detached(priority: .utility) { CLLocationManager.locationServicesEnabled() }.value
        guard !Task.isCancelled else { return .init(reason: "cancelled") }
        guard waiting == nil else { return .init(reason: "unavailable") }
        guard servicesEnabled else { return .init(reason: "services_disabled") }
        switch manager.authorizationStatus {
        case .denied: return .init(reason: "denied")
        case .restricted: return .init(reason: "restricted")
        case .notDetermined where !foreground: return .init(reason: "needs_foreground")
        default: break
        }
        guard foreground || liveActivity else { return .init(reason: "no_live_activity") }
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(returning: .init(reason: "cancelled")); return }
                waiting = continuation; requestID = id; requestStarted = false
                timeout = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(20))
                    guard !Task.isCancelled else { return }; self?.finish(.init(reason: "timeout"))
                }
                if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
                else { requestFix() }
            }
        } onCancel: { Task { @MainActor [weak self] in
            guard let self, self.requestID == id else { return }; self.cancel()
        } }
    }
    private func requestFix() {
        guard waiting != nil, !requestStarted else { return }; requestStarted = true
        // A live call already owns the Live Activity. The one-shot acquisition
        // may continue while locked; it ends on completion, timeout or hangup.
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.requestLocation()
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard waiting != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: requestFix()
        case .denied: finish(.init(reason: "denied"))
        case .restricted: finish(.init(reason: "restricted"))
        default: break
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard waiting != nil else { return }
        let valid = locations.compactMap { DeviceLocationResult.reading($0, reduced: manager.accuracyAuthorization == .reducedAccuracy) }
        if let best = valid.min(by: { $0.horizontalAccuracyM < $1.horizontalAccuracyM }) { finish(best) }
        else { finish(.init(reason: "stale")) }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(.init(reason: (error as? CLError)?.code == .denied ? "denied" : "unavailable"))
    }
    func cancel() { finish(.init(reason: "cancelled")) }
    private func finish(_ result: DeviceLocationResult) {
        let continuation = waiting; waiting = nil; requestID = nil; requestStarted = false
        timeout?.cancel(); timeout = nil
        manager.stopUpdatingLocation(); manager.allowsBackgroundLocationUpdates = false
        continuation?.resume(returning: result)
    }
}
