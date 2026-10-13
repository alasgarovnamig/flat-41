import CoreLocation
import Foundation
import Observation
import PhotosUI
import SwiftUI
import EvTapCore

/// A photo in the wizard: local (picked / camera, uploading) or already uploaded (edit mode).
struct WizardPhoto: Identifiable, Equatable {
    enum Status: Equatable { case uploading, done, failed }
    let id: String
    var preview: Data?
    var remoteURL: URL?
    var uploadId: String?
    var status: Status
    /// Downscaled JPEG kept for retries.
    var payload: Data?
}

@MainActor
@Observable
final class PostWizardViewModel {
    static let steps = ["type", "location", "details", "photos", "price", "review"]
    static let maxPhotos = 30
    /// Schema fields per step (to jump to the first step with an error).
    static let stepFields: [[String]] = [
        ["dealType", "propertyType", "buildingType"],
        ["cityId", "districtId", "metroId", "address", "lat", "lng"],
        ["area", "landArea", "rooms", "bathrooms", "floor", "totalFloors", "yearBuilt", "ceilingHeight", "repair", "amenities",
         "maxGuests", "minNights", "checkInTime", "checkOutTime", "houseRules"],
        ["imageIds"],
        ["price", "currency", "title", "description", "contactName", "contactPhone"],
        [],
    ]

    enum SubmitResult { case needsFee(String), submitted(String), updated }

    let editId: String?
    private(set) var loadingExisting = false
    var step = 0
    private(set) var errors: ValidationErrors = [:]
    private(set) var submitting = false
    private(set) var locating = false

    // Type
    var dealType: DealType?
    var propertyType: PropertyType?
    var buildingType: BuildingType = .SECONDARY
    // Location
    var cityId: String? = "baku"
    var districtId: String?
    var metroId: String?
    var address = ""
    var coordinate: CLLocationCoordinate2D?
    // Details
    var area = ""
    var landArea = ""
    var rooms: Int?
    var bathrooms = ""
    var floor = ""
    var totalFloors = ""
    var yearBuilt = ""
    var ceilingHeight = ""
    var repair: RepairType?
    var hasDocument = false
    var mortgageAvailable = false
    var amenities: [Amenity] = []
    var maxGuests = ""
    var minNights = ""
    var checkInTime = "14:00"
    var checkOutTime = "12:00"
    var houseRules = ""
    // Photos
    var photos: [WizardPhoto] = []
    // Price & contact
    var price = ""
    var currency: Currency = .AZN
    var title = ""
    var description = ""
    var contactName = ""
    var contactPhoneDigits = ""

    @ObservationIgnored private let location = LocationProvider()

    init(editId: String?) {
        self.editId = editId
        let me = AppServices.shared.session.me
        contactName = me?.name ?? ""
        contactPhoneDigits = Format.localDigits(me?.phone)
        if editId != nil { step = 5 }
    }

    var isDaily: Bool { dealType == .RENT_DAILY }
    var isApartmentLike: Bool { propertyType == .APARTMENT || propertyType == .ROOM || propertyType == .OFFICE }
    var hasLand: Bool { propertyType == .HOUSE || propertyType == .LAND }
    var hasRooms: Bool { propertyType != .LAND && propertyType != .GARAGE }
    var isUploading: Bool { photos.contains { $0.status == .uploading } }
    var progress: Double { Double(step + 1) / Double(Self.steps.count) }

    // MARK: Edit mode

    func loadExisting() async {
        guard let editId, dealType == nil else { return }
        loadingExisting = true
        defer { loadingExisting = false }
        do {
            let l = try await AppServices.shared.api.send(API.listing(editId))
            dealType = l.dealType
            propertyType = l.propertyType
            buildingType = l.buildingType ?? .SECONDARY
            cityId = l.cityId
            districtId = l.districtId
            metroId = l.metroId
            address = l.address ?? ""
            if let lat = l.lat, let lng = l.lng { coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng) }
            area = Format.number(l.area)
            landArea = l.landArea.map { Format.number($0) } ?? ""
            rooms = l.rooms
            bathrooms = l.bathrooms.map(String.init) ?? ""
            floor = l.floor.map(String.init) ?? ""
            totalFloors = l.totalFloors.map(String.init) ?? ""
            yearBuilt = l.yearBuilt.map(String.init) ?? ""
            ceilingHeight = l.ceilingHeight.map { Format.number($0) } ?? ""
            repair = l.repair
            hasDocument = l.hasDocument
            mortgageAvailable = l.mortgageAvailable
            amenities = l.amenities
            maxGuests = l.maxGuests.map(String.init) ?? ""
            minNights = l.minNights.map(String.init) ?? ""
            checkInTime = l.checkInTime ?? "14:00"
            checkOutTime = l.checkOutTime ?? "12:00"
            houseRules = l.houseRules ?? ""
            // contract v2: ListingImage.uploadId is what `imageIds` expects (older APIs: fall back to the image id).
            photos = l.orderedImages.map {
                WizardPhoto(id: $0.id, remoteURL: AppServices.shared.api.mediaURL($0.thumbUrl.isEmpty ? $0.url : $0.thumbUrl),
                            uploadId: $0.uploadId ?? $0.id, status: .done)
            }
            price = String(l.price)
            currency = l.currency
            title = l.title
            description = l.description
            contactName = l.contactName
            // contract v2: full contactPhone is returned to the owner.
            contactPhoneDigits = Format.localDigits(l.contactPhone ?? AppServices.shared.session.me?.phone)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    // MARK: Navigation

    func next() {
        if step == 0 {
            guard dealType != nil, propertyType != nil else {
                AppServices.shared.toast.show(L("post.fixErrors"), kind: .error)
                return
            }
        } else if step < 5 {
            guard validate(step: step) else { return }
            if step == 3 && isUploading { return }
        }
        errors = [:]
        step = min(step + 1, Self.steps.count - 1)
    }

    func back() { step = max(0, step - 1) }

    @discardableResult
    private func validate(step: Int) -> Bool {
        let all = Validation.listing(input())
        let relevant = all.filter { Self.stepFields[step].contains($0.key) }
        errors = relevant
        if !relevant.isEmpty { AppServices.shared.toast.show(L("post.fixErrors"), kind: .error) }
        return relevant.isEmpty
    }

    func error(_ field: String) -> String? { errors[field].map { L($0) } }

    // MARK: Input

    private func int(_ s: String) -> Int? { Int(s.trimmingCharacters(in: .whitespaces)) }
    private func double(_ s: String) -> Double? { Double(s.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)) }

    func input() -> ListingInput {
        ListingInput(
            dealType: dealType ?? .SALE,
            propertyType: propertyType ?? .APARTMENT,
            buildingType: propertyType == .APARTMENT ? buildingType : nil,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            price: int(price) ?? 0,
            currency: currency,
            cityId: cityId ?? "",
            districtId: districtId,
            metroId: metroId,
            address: address.trimmingCharacters(in: .whitespaces).isEmpty ? nil : address.trimmingCharacters(in: .whitespaces),
            lat: coordinate?.latitude,
            lng: coordinate?.longitude,
            area: double(area) ?? 0,
            landArea: hasLand ? double(landArea) : nil,
            rooms: hasRooms ? rooms : nil,
            bathrooms: hasRooms ? int(bathrooms) : nil,
            floor: int(floor),
            totalFloors: int(totalFloors),
            yearBuilt: int(yearBuilt),
            ceilingHeight: double(ceilingHeight),
            repair: propertyType == .LAND ? nil : repair,
            hasDocument: hasDocument,
            mortgageAvailable: dealType == .SALE ? mortgageAvailable : false,
            amenities: amenities,
            maxGuests: isDaily ? int(maxGuests) : nil,
            minNights: isDaily ? int(minNights) : nil,
            checkInTime: isDaily && !checkInTime.isEmpty ? checkInTime : nil,
            checkOutTime: isDaily && !checkOutTime.isEmpty ? checkOutTime : nil,
            houseRules: isDaily && !houseRules.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? houseRules : nil,
            contactName: contactName.trimmingCharacters(in: .whitespaces),
            contactPhone: contactPhoneDigits.isEmpty ? "" : "+994\(contactPhoneDigits)",
            imageIds: photos.compactMap { $0.status == .done ? $0.uploadId : nil }
        )
    }

    // MARK: Submit

    func submit() async -> SubmitResult? {
        guard dealType != nil, propertyType != nil else { step = 0; return nil }
        let data = input()
        let all = Validation.listing(data)
        if !all.isEmpty {
            errors = all
            if let s = Self.stepFields.firstIndex(where: { fields in fields.contains { all[$0] != nil } }) { step = s }
            AppServices.shared.toast.show(L("post.fixErrors"), kind: .error)
            return nil
        }
        submitting = true
        defer { submitting = false }
        do {
            let services = AppServices.shared
            if let editId {
                _ = try await services.api.send(API.updateListing(editId, data))
                services.bus.bump(.myListings, .listing, .me)
                services.toast.show(L("post.updated"), kind: .success)
                return .updated
            }
            let created = try await services.api.send(API.createListing(data))
            services.bus.bump(.myListings, .me)
            if created.requiresPayment { return .needsFee(created.id) }
            services.toast.show("\(L("post.submitted")) \(L("post.pendingModeration"))", kind: .success)
            return .submitted(created.id)
        } catch {
            AppServices.shared.toast.error(error)
            return nil
        }
    }

    // MARK: Location

    func useMyLocation() async {
        locating = true
        defer { locating = false }
        do {
            let c = try await location.current()
            coordinate = c
            if address.isEmpty, let street = await LocationProvider.streetAddress(latitude: c.latitude, longitude: c.longitude) {
                address = street
            }
        } catch LocationProvider.LocationError.denied {
            AppServices.shared.toast.show(L("post.locationDenied"), kind: .error)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    func cityChanged(_ id: String?) {
        guard id != cityId else { return }
        cityId = id
        districtId = nil
        metroId = nil
        coordinate = nil
    }

    // MARK: Photos

    func addPicked(_ items: [PhotosPickerItem]) async {
        let room = Self.maxPhotos - photos.count
        var added: [String] = []
        for item in items.prefix(max(0, room)) {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            added.append(await addImageData(data, upload: false))
        }
        await uploadPending(added)
    }

    func addCamera(_ data: Data) async {
        guard photos.count < Self.maxPhotos else { return }
        let id = await addImageData(data, upload: false)
        await uploadPending([id])
    }

    /// Downscale (≤1600px JPEG) and append; returns the photo id.
    private func addImageData(_ data: Data, upload: Bool) async -> String {
        let id = UUID().uuidString
        let jpeg = await ImageProcessing.prepareForUpload(data)
        let preview = await ImageProcessing.prepareForUpload(data, maxPixel: 400)
        photos.append(WizardPhoto(id: id, preview: preview, status: jpeg == nil ? .failed : .uploading, payload: jpeg))
        return id
    }

    /// Uploads two at a time (mobile-network friendly).
    private func uploadPending(_ ids: [String]) async {
        var queue = ids
        while !queue.isEmpty {
            let batch = Array(queue.prefix(2))
            queue.removeFirst(batch.count)
            await withTaskGroup(of: Void.self) { group in
                for id in batch {
                    group.addTask { @MainActor in await self.upload(id) }
                }
            }
        }
    }

    func retry(_ id: String) {
        guard let i = photos.firstIndex(where: { $0.id == id }), photos[i].payload != nil else { return }
        photos[i].status = .uploading
        Task { await upload(id) }
    }

    private func upload(_ id: String) async {
        guard let photo = photos.first(where: { $0.id == id }), let payload = photo.payload else { return }
        do {
            let up = try await AppServices.shared.api.upload(payload, filename: "photo-\(id.prefix(8)).jpg")
            if let i = photos.firstIndex(where: { $0.id == id }) {
                photos[i].uploadId = up.id
                photos[i].status = .done
                photos[i].remoteURL = AppServices.shared.api.mediaURL(up.thumbUrl)
            }
        } catch {
            if let i = photos.firstIndex(where: { $0.id == id }) { photos[i].status = .failed }
            AppServices.shared.toast.error(error)
        }
    }

    func remove(_ id: String) { photos.removeAll { $0.id == id } }

    func move(_ id: String, by delta: Int) {
        guard let i = photos.firstIndex(where: { $0.id == id }) else { return }
        let j = i + delta
        guard photos.indices.contains(j) else { return }
        photos.swapAt(i, j)
    }

    func makeCover(_ id: String) {
        guard let i = photos.firstIndex(where: { $0.id == id }), i > 0 else { return }
        let p = photos.remove(at: i)
        photos.insert(p, at: 0)
    }

    // MARK: Quota

    var quotaText: (text: String, paid: Bool)? {
        guard editId == nil else { return nil }
        if isDaily { return (L("post.dailyFree"), false) }
        guard let q = AppServices.shared.session.me?.quota else { return nil }
        if q.isUnlimited { return (L("post.quotaUnlimited"), false) }
        if q.remaining > 0 { return (L("post.quotaFree", ["n": q.remaining]), false) }
        return (L("post.quotaPaid", ["fee": Format.money(q.listingFee)]), true)
    }
}
