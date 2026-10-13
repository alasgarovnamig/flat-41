import Foundation

/// Strongly typed mirror of `listingSearchSchema` (minus page / pageSize / bbox, which the caller adds).
public struct ListingFilters: Sendable, Hashable {
    public var q: String?
    public var dealType: DealType?
    public var propertyType: [PropertyType] = []
    public var buildingType: BuildingType?
    public var country: CountryCode?
    public var cityId: String?
    public var districtId: [String] = []
    public var metroId: [String] = []
    public var priceMin: Int?
    public var priceMax: Int?
    public var currency: Currency?
    public var areaMin: Double?
    public var areaMax: Double?
    /// 5 means "5+".
    public var rooms: [Int] = []
    public var floorMin: Int?
    public var floorMax: Int?
    public var notFirstFloor = false
    public var notLastFloor = false
    public var repair: [RepairType] = []
    public var hasDocument = false
    public var mortgageAvailable = false
    public var amenities: [Amenity] = []
    public var ownerType: OwnerType?
    public var hasPhotos = false
    public var verified = false
    public var agencyId: String?
    public var ownerId: String?
    /// Daily-rent availability (YYYY-MM-DD).
    public var checkIn: String?
    public var checkOut: String?
    public var guests: Int?
    public var sort: ListingSort = .dateDesc

    public init() {}

    public init(dealType: DealType?) {
        self.dealType = dealType
    }

    public init(cityId: String?) {
        self.cityId = cityId
    }

    /// Number of active filters shown on the filter button (q, deal type and sort have their own controls).
    public var activeCount: Int {
        var n = 0
        if !propertyType.isEmpty { n += 1 }
        if buildingType != nil { n += 1 }
        if country != nil { n += 1 }
        if cityId != nil { n += 1 }
        if !districtId.isEmpty { n += 1 }
        if !metroId.isEmpty { n += 1 }
        if priceMin != nil { n += 1 }
        if priceMax != nil { n += 1 }
        if currency != nil { n += 1 }
        if areaMin != nil { n += 1 }
        if areaMax != nil { n += 1 }
        if !rooms.isEmpty { n += 1 }
        if floorMin != nil { n += 1 }
        if floorMax != nil { n += 1 }
        if notFirstFloor { n += 1 }
        if notLastFloor { n += 1 }
        if !repair.isEmpty { n += 1 }
        if hasDocument { n += 1 }
        if mortgageAvailable { n += 1 }
        if !amenities.isEmpty { n += 1 }
        if ownerType != nil { n += 1 }
        if hasPhotos { n += 1 }
        if verified { n += 1 }
        if checkIn != nil { n += 1 }
        if guests != nil { n += 1 }
        return n
    }

    /// Swaps inverted ranges instead of sending a query the API would reject; trims the text query.
    public func cleaned() -> ListingFilters {
        var f = self
        if let a = f.priceMin, let b = f.priceMax, a > b { f.priceMin = b; f.priceMax = a }
        if let a = f.areaMin, let b = f.areaMax, a > b { f.areaMin = b; f.areaMax = a }
        if let a = f.floorMin, let b = f.floorMax, a > b { f.floorMin = b; f.floorMax = a }
        let trimmed = f.q?.trimmingCharacters(in: .whitespacesAndNewlines)
        f.q = (trimmed?.isEmpty ?? true) ? nil : String(trimmed!.prefix(100))
        if f.checkOut != nil && f.checkIn == nil { f.checkOut = nil }
        if f.dealType != .RENT_DAILY {
            f.checkIn = nil
            f.checkOut = nil
            f.guests = nil
        }
        return f
    }

    /// Clears everything except the text query, deal type and sort.
    public func reset() -> ListingFilters {
        var f = ListingFilters()
        f.q = q
        f.dealType = dealType
        f.sort = sort
        return f
    }

    /// Query parameters for `GET /listings` and `GET /listings/map`.
    public func queryParams(page: Int? = nil, pageSize: Int? = nil, bbox: String? = nil) -> [QueryParam] {
        let f = cleaned()
        var b = QueryBuilder()
        b.add("q", f.q)
        b.add("dealType", f.dealType)
        b.add("propertyType", csv: f.propertyType.map(\.rawValue))
        b.add("buildingType", f.buildingType)
        b.add("country", f.country)
        b.add("cityId", f.cityId)
        b.add("districtId", csv: f.districtId)
        b.add("metroId", csv: f.metroId)
        b.add("priceMin", f.priceMin)
        b.add("priceMax", f.priceMax)
        b.add("currency", f.currency)
        b.add("areaMin", f.areaMin)
        b.add("areaMax", f.areaMax)
        b.add("rooms", csv: f.rooms.sorted().map(String.init))
        b.add("floorMin", f.floorMin)
        b.add("floorMax", f.floorMax)
        b.add("notFirstFloor", flag: f.notFirstFloor)
        b.add("notLastFloor", flag: f.notLastFloor)
        b.add("repair", csv: f.repair.map(\.rawValue))
        b.add("hasDocument", flag: f.hasDocument)
        b.add("mortgageAvailable", flag: f.mortgageAvailable)
        b.add("amenities", csv: f.amenities.map(\.rawValue))
        b.add("ownerType", f.ownerType)
        b.add("hasPhotos", flag: f.hasPhotos)
        b.add("verified", flag: f.verified)
        b.add("agencyId", f.agencyId)
        b.add("ownerId", f.ownerId)
        b.add("checkIn", f.checkIn)
        b.add("checkOut", f.checkOut)
        b.add("guests", f.guests)
        b.add("bbox", bbox)
        b.add("sort", f.sort.rawValue)
        b.add("page", page)
        b.add("pageSize", pageSize)
        return b.params
    }

    /// JSON object stored in `SavedSearch.query` (same keys/values as the query string).
    public var savedQuery: [String: JSONValue] {
        var o: [String: JSONValue] = [:]
        for p in queryParams() {
            switch p.name {
            case "propertyType", "districtId", "metroId", "repair", "amenities":
                o[p.name] = .array(p.value.split(separator: ",").map { .string(String($0)) })
            case "rooms":
                o[p.name] = .array(p.value.split(separator: ",").compactMap { Double($0) }.map { .number($0) })
            case "priceMin", "priceMax", "areaMin", "areaMax", "floorMin", "floorMax", "guests":
                o[p.name] = Double(p.value).map { .number($0) } ?? .string(p.value)
            case "notFirstFloor", "notLastFloor", "hasDocument", "mortgageAvailable", "hasPhotos", "verified":
                o[p.name] = .bool(true)
            default:
                o[p.name] = .string(p.value)
            }
        }
        return o
    }

    /// Rebuild filters from a saved search / deep link query (lenient: unknown values are ignored).
    public init(savedQuery q: [String: JSONValue]) {
        self.init()
        self.q = q["q"]?.stringValue
        dealType = q["dealType"]?.stringValue.flatMap(DealType.init(rawValue:))
        propertyType = (q["propertyType"]?.stringArray ?? []).compactMap(PropertyType.init(rawValue:))
        buildingType = q["buildingType"]?.stringValue.flatMap(BuildingType.init(rawValue:))
        country = q["country"]?.stringValue.flatMap(CountryCode.init(rawValue:))
        cityId = q["cityId"]?.stringValue
        districtId = q["districtId"]?.stringArray ?? []
        metroId = q["metroId"]?.stringArray ?? []
        priceMin = q["priceMin"]?.intValue
        priceMax = q["priceMax"]?.intValue
        currency = q["currency"]?.stringValue.flatMap(Currency.init(rawValue:))
        areaMin = q["areaMin"]?.doubleValue
        areaMax = q["areaMax"]?.doubleValue
        if case .array(let a)? = q["rooms"] {
            rooms = a.compactMap(\.intValue)
        } else {
            rooms = (q["rooms"]?.stringArray ?? []).compactMap { Int($0) }
        }
        floorMin = q["floorMin"]?.intValue
        floorMax = q["floorMax"]?.intValue
        notFirstFloor = q["notFirstFloor"]?.boolValue ?? false
        notLastFloor = q["notLastFloor"]?.boolValue ?? false
        repair = (q["repair"]?.stringArray ?? []).compactMap(RepairType.init(rawValue:))
        hasDocument = q["hasDocument"]?.boolValue ?? false
        mortgageAvailable = q["mortgageAvailable"]?.boolValue ?? false
        amenities = (q["amenities"]?.stringArray ?? []).compactMap(Amenity.init(rawValue:))
        ownerType = q["ownerType"]?.stringValue.flatMap(OwnerType.init(rawValue:))
        hasPhotos = q["hasPhotos"]?.boolValue ?? false
        verified = q["verified"]?.boolValue ?? false
        agencyId = q["agencyId"]?.stringValue
        ownerId = q["ownerId"]?.stringValue
        checkIn = q["checkIn"]?.stringValue
        checkOut = q["checkOut"]?.stringValue
        guests = q["guests"]?.intValue
        sort = q["sort"]?.stringValue.flatMap(ListingSort.init(rawValue:)) ?? .dateDesc
    }
}

/// Map bounding box as the API expects it: "minLng,minLat,maxLng,maxLat".
public struct BoundingBox: Sendable, Hashable {
    public var minLat: Double
    public var minLng: Double
    public var maxLat: Double
    public var maxLng: Double

    public init(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) {
        self.minLat = minLat
        self.minLng = minLng
        self.maxLat = maxLat
        self.maxLng = maxLng
    }

    /// From a map region centre + span (degrees), clamped to valid coordinates.
    public init(centerLat: Double, centerLng: Double, latDelta: Double, lngDelta: Double) {
        minLat = max(-90, centerLat - latDelta / 2)
        maxLat = min(90, centerLat + latDelta / 2)
        minLng = max(-180, centerLng - lngDelta / 2)
        maxLng = min(180, centerLng + lngDelta / 2)
    }

    /// 5 decimals ≈ 1 m — keeps the string stable while the map barely moves.
    public var queryValue: String {
        func f(_ v: Double) -> String { String(format: "%.5f", v) }
        return "\(f(minLng)),\(f(minLat)),\(f(maxLng)),\(f(maxLat))"
    }
}
