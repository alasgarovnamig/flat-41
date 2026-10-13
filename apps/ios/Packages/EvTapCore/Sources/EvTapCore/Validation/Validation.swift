import Foundation

/// Client-side mirror of the zod schemas (`packages/shared/src/schemas.ts`). Errors carry a localization key
/// (`validation.*`) and optional arguments so the UI shows them next to the field.
public struct ValidationIssue: Sendable, Hashable {
    public let key: String
    public let args: [String: String]
    public init(_ key: String, _ args: [String: String] = [:]) {
        self.key = key
        self.args = args
    }

    public static let required = ValidationIssue("validation.required")
    public static let invalid = ValidationIssue("validation.invalid")
    public static func minLength(_ n: Int) -> ValidationIssue { ValidationIssue("validation.minLength", ["n": "\(n)"]) }
    public static func maxLength(_ n: Int) -> ValidationIssue { ValidationIssue("validation.maxLength", ["n": "\(n)"]) }
    public static func range(_ min: String, _ max: String) -> ValidationIssue { ValidationIssue("validation.range", ["min": min, "max": max]) }
}

public typealias ValidationErrors = [String: ValidationIssue]

public enum Validation {
    // MARK: Phone

    /// `phoneSchema`: strips spaces / brackets / dashes, maps "0XXXXXXXXX" → "+994XXXXXXXXX", accepts +994 / +995 mobiles.
    public static func normalizePhone(_ raw: String) -> String? {
        var v = raw.trimmingCharacters(in: .whitespacesAndNewlines).filter { !" ()-".contains($0) }
        if v.hasPrefix("0") && v.count == 10 { v = "+994" + v.dropFirst() }
        let digits = v.dropFirst()
        guard v.count == 13, v.hasPrefix("+99"), let fourth = v.dropFirst(3).first, fourth == "4" || fourth == "5",
              digits.allSatisfy(\.isNumber) else { return nil }
        return v
    }

    /// National digits typed after the fixed "+994" prefix.
    public static func phoneFromLocal(_ digits: String) -> String? { normalizePhone("+994" + digits) }

    public static func isValidEmail(_ s: String) -> Bool {
        let v = s.trimmingCharacters(in: .whitespaces)
        guard let at = v.firstIndex(of: "@"), at != v.startIndex else { return false }
        let domain = v[v.index(after: at)...]
        return !domain.isEmpty && domain.contains(".") && !domain.hasPrefix(".") && !domain.hasSuffix(".") && !v.contains(" ")
            && v.filter { $0 == "@" }.count == 1
    }

    public static func isValidURL(_ s: String) -> Bool {
        guard let u = URL(string: s), let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https", u.host != nil else { return false }
        return true
    }

    /// "HH:MM"
    public static func isTime(_ s: String) -> Bool {
        let p = s.split(separator: ":")
        guard p.count == 2, p[0].count == 2, p[1].count == 2, let h = Int(p[0]), let m = Int(p[1]) else { return false }
        return (0...23).contains(h) && (0...59).contains(m)
    }

    public static func isOtpCode(_ s: String) -> Bool { (4...6).contains(s.count) && s.allSatisfy(\.isNumber) }

    // MARK: Auth

    public static func register(name: String, email: String, password: String) -> ValidationErrors {
        var e = ValidationErrors()
        let n = name.trimmingCharacters(in: .whitespaces)
        if n.count < 2 { e["name"] = .minLength(2) } else if n.count > 80 { e["name"] = .maxLength(80) }
        if !isValidEmail(email) { e["email"] = .invalid }
        if password.count < 8 { e["password"] = .minLength(8) } else if password.count > 100 { e["password"] = .maxLength(100) }
        return e
    }

    public static func login(login: String, password: String) -> ValidationErrors {
        var e = ValidationErrors()
        if login.trimmingCharacters(in: .whitespaces).count < 3 { e["login"] = .minLength(3) }
        if password.isEmpty { e["password"] = .required }
        return e
    }

    public static func profile(name: String, email: String) -> ValidationErrors {
        var e = ValidationErrors()
        let n = name.trimmingCharacters(in: .whitespaces)
        if n.count < 2 { e["name"] = .minLength(2) } else if n.count > 80 { e["name"] = .maxLength(80) }
        if !email.isEmpty, !isValidEmail(email) { e["email"] = .invalid }
        return e
    }

    // MARK: Listing (createListingSchema + its superRefine)

    public static func listing(_ v: ListingInput) -> ValidationErrors {
        var e = ValidationErrors()
        let title = v.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.count < 10 { e["title"] = .minLength(10) } else if title.count > 120 { e["title"] = .maxLength(120) }
        let desc = v.description.trimmingCharacters(in: .whitespacesAndNewlines)
        if desc.count < 30 { e["description"] = .minLength(30) } else if desc.count > 5000 { e["description"] = .maxLength(5000) }
        if v.price <= 0 || v.price > 1_000_000_000 { e["price"] = .range("1", "1 000 000 000") }
        if v.cityId.count < 2 { e["cityId"] = .required }
        if let a = v.address, a.count > 200 { e["address"] = .maxLength(200) }
        if let lat = v.lat, !(-90...90).contains(lat) { e["lat"] = .invalid }
        if let lng = v.lng, !(-180...180).contains(lng) { e["lng"] = .invalid }
        if v.area <= 0 || v.area > 100_000 { e["area"] = .range("1", "100 000") }
        if let a = v.landArea, a <= 0 || a > 100_000 { e["landArea"] = .range("1", "100 000") }
        if let r = v.rooms, !(0...50).contains(r) { e["rooms"] = .range("0", "50") }
        if let b = v.bathrooms, !(0...20).contains(b) { e["bathrooms"] = .range("0", "20") }
        if let f = v.floor, !(-5...200).contains(f) { e["floor"] = .range("-5", "200") }
        if let t = v.totalFloors, !(1...200).contains(t) { e["totalFloors"] = .range("1", "200") }
        if let y = v.yearBuilt, !(1800...2100).contains(y) { e["yearBuilt"] = .range("1800", "2100") }
        if let c = v.ceilingHeight, !(2...10).contains(c) { e["ceilingHeight"] = .range("2", "10") }
        if let g = v.maxGuests, !(1...50).contains(g) { e["maxGuests"] = .range("1", "50") }
        if let n = v.minNights, !(1...365).contains(n) { e["minNights"] = .range("1", "365") }
        if let t = v.checkInTime, !isTime(t) { e["checkInTime"] = .invalid }
        if let t = v.checkOutTime, !isTime(t) { e["checkOutTime"] = .invalid }
        if let r = v.houseRules, r.count > 2000 { e["houseRules"] = .maxLength(2000) }
        let contact = v.contactName.trimmingCharacters(in: .whitespaces)
        if contact.count < 2 { e["contactName"] = .minLength(2) } else if contact.count > 80 { e["contactName"] = .maxLength(80) }
        if normalizePhone(v.contactPhone) == nil { e["contactPhone"] = .invalid }
        if v.imageIds.isEmpty { e["imageIds"] = ValidationIssue("validation.photosRequired") } else if v.imageIds.count > 30 { e["imageIds"] = .maxLength(30) }
        // superRefine
        if v.dealType == .RENT_DAILY, v.maxGuests == nil, e["maxGuests"] == nil { e["maxGuests"] = .required }
        if let f = v.floor, let t = v.totalFloors, f > t, e["floor"] == nil { e["floor"] = ValidationIssue("validation.floorAboveTotal") }
        if v.propertyType.requiresRooms, v.rooms == nil, e["rooms"] == nil { e["rooms"] = .required }
        return e
    }

    // MARK: Misc

    public static func review(rating: Int, comment: String) -> ValidationErrors {
        var e = ValidationErrors()
        if !(1...5).contains(rating) { e["rating"] = .range("1", "5") }
        let c = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        if c.count < 5 { e["comment"] = .minLength(5) } else if c.count > 2000 { e["comment"] = .maxLength(2000) }
        return e
    }

    public static func agency(_ v: AgencyInput) -> ValidationErrors {
        var e = ValidationErrors()
        let n = v.name.trimmingCharacters(in: .whitespaces)
        if n.count < 2 { e["name"] = .minLength(2) } else if n.count > 120 { e["name"] = .maxLength(120) }
        if let d = v.description, d.count > 5000 { e["description"] = .maxLength(5000) }
        if let p = v.phone, normalizePhone(p) == nil { e["phone"] = .invalid }
        if let m = v.email, !isValidEmail(m) { e["email"] = .invalid }
        if let w = v.website, !isValidURL(w) { e["website"] = .invalid }
        if let a = v.address, a.count > 200 { e["address"] = .maxLength(200) }
        return e
    }

    /// Message body: trimmed, 1…2000 characters (`sendMessageSchema`).
    public static func messageBody(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return (1...2000).contains(t.count) ? t : nil
    }

    public static func topup(amount: Int, settings: CatalogSettings) -> Bool {
        amount >= max(100, settings.minTopup) && amount <= settings.maxTopup
    }
}
