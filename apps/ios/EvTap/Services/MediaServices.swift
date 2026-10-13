import CoreLocation
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Photo preparation before `POST /uploads`: decode, honour EXIF orientation, downscale so the longest side
/// is ≤ `maxPixel`, re-encode as JPEG. ImageIO thumbnails are memory-efficient and thread-safe.
enum ImageProcessing {
    static func downscaledJPEG(_ data: Data, maxPixel: Int = 1600, quality: Double = 0.8) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }

    /// Runs `downscaledJPEG` off the main actor.
    static func prepareForUpload(_ data: Data, maxPixel: Int = 1600) async -> Data? {
        await Task.detached(priority: .userInitiated) { downscaledJPEG(data, maxPixel: maxPixel) }.value
    }
}

/// One-shot current location (post-listing map pin) with the when-in-use permission prompt.
@MainActor
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    enum LocationError: Error { case denied, unavailable }

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D, Error>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func current() async throws -> CLLocationCoordinate2D {
        if let pending = continuation {
            continuation = nil
            pending.resume(throwing: LocationError.unavailable)
        }
        return try await withCheckedThrowingContinuation { cont in
            continuation = cont
            switch manager.authorizationStatus {
            case .notDetermined: manager.requestWhenInUseAuthorization()
            case .denied, .restricted: finish(.failure(LocationError.denied))
            default: manager.requestLocation()
            }
        }
    }

    private func finish(_ result: Result<CLLocationCoordinate2D, Error>) {
        guard let c = continuation else { return }
        continuation = nil
        c.resume(with: result)
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard self.continuation != nil else { return }
            switch status {
            case .authorizedWhenInUse, .authorizedAlways: self.manager.requestLocation()
            case .denied, .restricted: self.finish(.failure(LocationError.denied))
            default: break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let c = locations.last?.coordinate else { return }
        let lat = c.latitude
        let lng = c.longitude
        Task { @MainActor in self.finish(.success(CLLocationCoordinate2D(latitude: lat, longitude: lng))) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(.failure(LocationError.unavailable)) }
    }

    /// "Street 12" for the address field (best effort).
    nonisolated static func streetAddress(latitude: Double, longitude: Double) async -> String? {
        let placemarks = try? await CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: latitude, longitude: longitude))
        guard let p = placemarks?.first else { return nil }
        let parts = [p.thoroughfare, p.subThoroughfare].compactMap { $0 }
        return parts.isEmpty ? p.name : parts.joined(separator: " ")
    }
}
