import Foundation

/// Reference geography (port of `packages/shared/src/locations.ts`, shipped as `locations.json`; same shape as
/// `GET /locations`).
public struct LocationsData: Codable, Sendable, Hashable {
    public struct Country: Codable, Sendable, Hashable, Identifiable {
        public var id: String { code.rawValue }
        public let code: CountryCode
        public let name: LocalizedText
        public let currency: String
        public let phonePrefix: String
    }

    public struct City: Codable, Sendable, Hashable, Identifiable {
        public let id: String
        public let country: CountryCode
        public let name: LocalizedText
        public let lat: Double
        public let lng: Double
        public let popular: Bool?
    }

    public struct District: Codable, Sendable, Hashable, Identifiable {
        public let id: String
        public let cityId: String
        public let name: LocalizedText
    }

    public enum MetroLine: String, Codable, Sendable { case red, green, purple }

    public struct MetroStation: Codable, Sendable, Hashable, Identifiable {
        public let id: String
        public let cityId: String
        public let line: MetroLine
        public let name: LocalizedText
        public let lat: Double
        public let lng: Double
    }

    public let countries: [Country]
    public let cities: [City]
    public let districts: [District]
    public let metroStations: [MetroStation]

    public static let empty = LocationsData(countries: [], cities: [], districts: [], metroStations: [])

    public init(countries: [Country], cities: [City], districts: [District], metroStations: [MetroStation]) {
        self.countries = countries
        self.cities = cities
        self.districts = districts
        self.metroStations = metroStations
    }
}

/// Indexed lookups over `LocationsData`.
public struct Locations: Sendable {
    public let data: LocationsData
    private let cityById: [String: LocationsData.City]
    private let districtById: [String: LocationsData.District]
    private let metroById: [String: LocationsData.MetroStation]

    public init(_ data: LocationsData) {
        self.data = data
        cityById = Dictionary(data.cities.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        districtById = Dictionary(data.districts.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        metroById = Dictionary(data.metroStations.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    public init(json: Data) throws {
        self.init(try JSONDecoder().decode(LocationsData.self, from: json))
    }

    public var cities: [LocationsData.City] { data.cities }
    public var popularCities: [LocationsData.City] { data.cities.filter { $0.popular == true } }
    public func city(_ id: String?) -> LocationsData.City? { id.flatMap { cityById[$0] } }
    public func district(_ id: String?) -> LocationsData.District? { id.flatMap { districtById[$0] } }
    public func metro(_ id: String?) -> LocationsData.MetroStation? { id.flatMap { metroById[$0] } }
    public func districts(of cityId: String?) -> [LocationsData.District] { data.districts.filter { $0.cityId == cityId } }
    public func metros(of cityId: String?) -> [LocationsData.MetroStation] { data.metroStations.filter { $0.cityId == cityId } }
    public func cities(in country: CountryCode?) -> [LocationsData.City] {
        guard let country else { return data.cities }
        return data.cities.filter { $0.country == country }
    }

    /// "Ⓜ 28 May, Nəsimi r., Bakı" — metro, district, city (the card / detail location line).
    public func label(cityId: String, districtId: String?, metroId: String?, lang: Lang) -> String {
        [
            metro(metroId).map { "Ⓜ \($0.name.resolve(lang))" },
            district(districtId)?.name.resolve(lang),
            city(cityId)?.name.resolve(lang),
        ].compactMap { $0 }.joined(separator: ", ")
    }
}
