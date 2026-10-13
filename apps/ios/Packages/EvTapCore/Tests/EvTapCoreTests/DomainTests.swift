import XCTest
@testable import EvTapCore

final class FiltersTests: XCTestCase {
    func testActiveCountIgnoresQueryDealAndSort() {
        var f = ListingFilters(dealType: .SALE)
        f.q = "metro"
        f.sort = .priceAsc
        XCTAssertEqual(f.activeCount, 0)
        f.cityId = "baku"
        f.rooms = [2, 3]
        f.hasDocument = true
        XCTAssertEqual(f.activeCount, 3)
    }

    func testCleanedSwapsInvertedRangesAndDropsDailyFieldsForOtherDeals() {
        var f = ListingFilters(dealType: .SALE)
        f.priceMin = 200_000
        f.priceMax = 100_000
        f.checkIn = "2026-10-20"
        f.guests = 2
        let c = f.cleaned()
        XCTAssertEqual(c.priceMin, 100_000)
        XCTAssertEqual(c.priceMax, 200_000)
        XCTAssertNil(c.checkIn)
        XCTAssertNil(c.guests)
    }

    func testSavedQueryRoundTrip() {
        var f = ListingFilters(dealType: .RENT_DAILY)
        f.cityId = "gabala"
        f.rooms = [2, 5]
        f.amenities = [.POOL, .WIFI]
        f.notFirstFloor = true
        f.checkIn = "2026-11-01"
        f.checkOut = "2026-11-04"
        f.guests = 3
        f.priceMax = 150
        let q = f.savedQuery
        XCTAssertEqual(q["rooms"], .array([.number(2), .number(5)]))
        XCTAssertEqual(q["notFirstFloor"], .bool(true))
        XCTAssertEqual(ListingFilters(savedQuery: q), f.cleaned())
    }

    func testSavedQueryAcceptsCSVStrings() {
        let f = ListingFilters(savedQuery: ["propertyType": .string("APARTMENT,HOUSE"), "rooms": .string("1,2"), "hasPhotos": .string("true")])
        XCTAssertEqual(f.propertyType, [.APARTMENT, .HOUSE])
        XCTAssertEqual(f.rooms, [1, 2])
        XCTAssertTrue(f.hasPhotos)
    }

    func testBoundingBoxString() {
        let b = BoundingBox(centerLat: 40.4, centerLng: 49.86, latDelta: 0.2, lngDelta: 0.4)
        XCTAssertEqual(b.queryValue, "49.66000,40.30000,50.06000,40.50000")
    }
}

final class ValidationTests: XCTestCase {
    func testPhoneSchemaPort() {
        XCTAssertEqual(Validation.normalizePhone("+994 50 123 45 67"), "+994501234567")
        XCTAssertEqual(Validation.normalizePhone("0501234567"), "+994501234567")
        XCTAssertEqual(Validation.normalizePhone("(+995) 555-123-456"), "+995555123456")
        XCTAssertNil(Validation.normalizePhone("+99450123456"))
        XCTAssertNil(Validation.normalizePhone("+7 900 123 45 67"))
        XCTAssertEqual(Validation.phoneFromLocal("501234567"), "+994501234567")
    }

    func testEmailAndTime() {
        XCTAssertTrue(Validation.isValidEmail("a@evtap.az"))
        XCTAssertFalse(Validation.isValidEmail("a@evtap"))
        XCTAssertFalse(Validation.isValidEmail("@evtap.az"))
        XCTAssertTrue(Validation.isTime("14:00"))
        XCTAssertFalse(Validation.isTime("24:00"))
        XCTAssertTrue(Validation.isOtpCode("123456"))
        XCTAssertFalse(Validation.isOtpCode("12a456"))
    }

    func testListingRefinements() {
        var v = ListingInput(dealType: .RENT_DAILY, propertyType: .APARTMENT, title: "Qısa", description: "qısa", price: 0, cityId: "baku",
                             area: 50, floor: 10, totalFloors: 5, contactName: "E", contactPhone: "123", imageIds: [])
        let e = Validation.listing(v)
        XCTAssertEqual(e["title"], .minLength(10))
        XCTAssertEqual(e["description"], .minLength(30))
        XCTAssertNotNil(e["price"])
        XCTAssertEqual(e["maxGuests"], .required)
        XCTAssertEqual(e["floor"]?.key, "validation.floorAboveTotal")
        XCTAssertEqual(e["rooms"], .required)
        XCTAssertEqual(e["contactPhone"], .invalid)
        XCTAssertEqual(e["imageIds"]?.key, "validation.photosRequired")

        v.title = "2 otaqlı günlük mənzil, dəniz kənarı"
        v.description = String(repeating: "Gözəl mənzil. ", count: 4)
        v.price = 80
        v.maxGuests = 4
        v.floor = 3
        v.rooms = 2
        v.contactName = "Elvin"
        v.contactPhone = "+994501234567"
        v.imageIds = ["u1"]
        XCTAssertEqual(Validation.listing(v), [:])
    }

    func testReviewAndMessage() {
        XCTAssertEqual(Validation.review(rating: 0, comment: "ok")["rating"], .range("1", "5"))
        XCTAssertEqual(Validation.review(rating: 5, comment: "Əla yer!"), [:])
        XCTAssertNil(Validation.messageBody("   "))
        XCTAssertEqual(Validation.messageBody("  salam "), "salam")
    }
}

final class DeepLinkTests: XCTestCase {
    func testCustomScheme() {
        XCTAssertEqual(DeepLink.parse(URL(string: "evtap://listing/abc-123")!), .listing(id: "abc-123"))
        XCTAssertEqual(DeepLink.parse(URL(string: "evtap://payment/result?paymentId=p1&status=SUCCEEDED")!),
                       .paymentResult(paymentId: "p1", status: "SUCCEEDED"))
        XCTAssertNil(DeepLink.parse(URL(string: "evtap://payment/result")!))
        XCTAssertEqual(DeepLink.parse(URL(string: "evtap://chat/c1")!), .conversation(id: "c1"))
    }

    func testUniversalLinks() {
        XCTAssertEqual(DeepLink.parse(URL(string: "https://evtap.az/listing/xyz")!), .listing(id: "xyz"))
        XCTAssertEqual(DeepLink.parse(URL(string: "https://www.evtap.az/ru/listing/xyz")!), .listing(id: "xyz"))
        XCTAssertNil(DeepLink.parse(URL(string: "https://example.com/listing/xyz")!))
        if case .search(let f)? = DeepLink.parse(URL(string: "https://evtap.az/search?dealType=RENT_DAILY&cityId=gabala")!) {
            XCTAssertEqual(f.dealType, .RENT_DAILY)
            XCTAssertEqual(f.cityId, "gabala")
        } else {
            XCTFail("expected search link")
        }
    }

    func testNotificationPayloadPriority() {
        XCTAssertEqual(DeepLink.from(notificationData: ["url": .string("evtap://booking/b1"), "listingId": .string("l1")]), .booking(id: "b1"))
        XCTAssertEqual(DeepLink.from(notificationData: ["paymentId": .string("p1")]), .paymentResult(paymentId: "p1", status: nil))
        XCTAssertNil(DeepLink.from(notificationData: [:]))
    }
}

final class RealtimeCodecTests: XCTestCase {
    func testParsesServerFrames() {
        XCTAssertEqual(RealtimeCodec.decode(#"{"event":"ping"}"#), .ping)
        let msg = RealtimeCodec.decode(#"{"event":"message:new","data":{"id":"m1","conversationId":"c1","senderId":"u2","body":"Salam","createdAt":"2026-10-13T10:00:00.000Z","readAt":null}}"#)
        guard case .event(.messageNew(let m))? = msg else { return XCTFail("expected message") }
        XCTAssertEqual(m.body, "Salam")
        let typing = RealtimeCodec.decode(#"{"event":"typing","data":{"conversationId":"c1","userId":"u2"}}"#)
        XCTAssertEqual(typing, .event(.typing(TypingEvent(conversationId: "c1", userId: "u2"))))
        XCTAssertEqual(RealtimeCodec.decode(#"{"event":"something"}"#), .unknown("something"))
        XCTAssertNil(RealtimeCodec.decode("not json"))
    }

    func testClientFramesAndURL() throws {
        let typing = try JSONSerialization.jsonObject(with: Data(RealtimeCodec.typing(conversationId: "c1").utf8)) as! [String: Any]
        XCTAssertEqual(typing["event"] as? String, "typing")
        XCTAssertEqual((typing["data"] as? [String: String])?["conversationId"], "c1")
        XCTAssertEqual(RealtimeCodec.pong, #"{"event":"pong"}"#)
        XCTAssertEqual(RealtimeCodec.socketURL(origin: URL(string: "https://api.evtap.az")!, token: "t.k")?.absoluteString, "wss://api.evtap.az/ws?token=t.k")
        XCTAssertEqual(RealtimeCodec.socketURL(origin: URL(string: "http://localhost:4000")!, token: "x")?.absoluteString, "ws://localhost:4000/ws?token=x")
    }

    func testBackoff() {
        XCTAssertEqual((0..<7).map { RealtimeCodec.backoff(attempt: $0) }, [1, 2, 4, 8, 16, 30, 30])
    }
}

final class MiscTests: XCTestCase {
    func point(_ id: String, _ lat: Double, _ lng: Double, _ price: Int) -> MapPoint {
        MapPoint(id: id, lat: lat, lng: lng, price: price, currency: .AZN, pricePeriod: .TOTAL, isVip: false, isPremium: false, title: id, coverUrl: nil)
    }

    func testClusteringGroupsNearbyPoints() {
        let pts = [point("a", 40.4001, 49.8601, 100), point("b", 40.4002, 49.8602, 90), point("c", 40.49, 49.99, 300)]
        let clusters = MapClustering.cluster(pts, latSpan: 0.2, lngSpan: 0.2)
        XCTAssertEqual(clusters.count, 2)
        let big = clusters.first { $0.count == 2 }!
        XCTAssertEqual(big.minPrice, 90)
        XCTAssertTrue(clusters.contains { $0.isSingle && $0.id == "c" })
    }

    func testMarkdownBlocks() {
        let blocks = MarkdownBlock.parse("# Haqqımızda\n\nEvTap **ən yaxşı**\nplatformadır.\n\n- Satış\n- Kirayə\n1. Bir\n<p>HTML</p>")
        XCTAssertEqual(blocks, [
            .heading(level: 1, text: "Haqqımızda"),
            .paragraph("EvTap **ən yaxşı** platformadır."),
            .bullet("Satış"), .bullet("Kirayə"), .numbered(1, "Bir"), .paragraph("HTML"),
        ])
    }

    func testLocationsJSONShipsWithTheApp() throws {
        // apps/ios/EvTap/Resources/locations.json (generated from packages/shared/src/locations.ts)
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("EvTap/Resources/locations.json")
        let locations = try Locations(json: Data(contentsOf: url))
        XCTAssertEqual(locations.city("baku")?.name.resolve(.en), "Baku")
        XCTAssertEqual(locations.districts(of: "baku").count, 12)
        XCTAssertFalse(locations.metros(of: "baku").isEmpty)
        XCTAssertTrue(locations.popularCities.contains { $0.id == "gabala" })
        XCTAssertEqual(locations.label(cityId: "baku", districtId: "baku-nasimi", metroId: "28-may", lang: .az), "Ⓜ 28 May, Nəsimi r., Bakı")
    }

    func testLangDetection() {
        XCTAssertEqual(Lang.best(for: ["ru-AZ", "en"]), .ru)
        XCTAssertEqual(Lang.best(for: ["de-DE", "en-US"]), .en)
        XCTAssertEqual(Lang.best(for: ["fr"]), .az)
    }

    func testLocalizedTextFallsBackToAzerbaijani() {
        XCTAssertEqual(LocalizedText(az: "Bakı", ru: "", en: "Baku").resolve(.ru), "Bakı")
    }
}
