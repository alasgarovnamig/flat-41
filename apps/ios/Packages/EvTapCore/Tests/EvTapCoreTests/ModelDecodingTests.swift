import XCTest
@testable import EvTapCore

final class ModelDecodingTests: XCTestCase {
    static let card = """
    "id":"6f1c0a52-8a7e-4c1b-9d5e-1b2c3d4e5f60","title":"3 otaqlı mənzil, Nəsimi","dealType":"SALE","propertyType":"APARTMENT",
    "buildingType":"NEW","price":185000,"currency":"AZN","pricePeriod":"TOTAL","country":"AZ","cityId":"baku",
    "districtId":"baku-nasimi","metroId":"28-may","address":"Rəşid Behbudov 12","area":92.5,"landArea":null,"rooms":3,
    "floor":7,"totalFloors":16,"coverUrl":"/uploads/a.webp","imagesCount":12,"lat":40.38,"lng":49.85,"isVip":true,
    "isPremium":false,"isHighlighted":false,"isUrgent":true,"isVerified":false,"hasDocument":true,"mortgageAvailable":true,
    "isBusiness":false,"rating":null,"status":"ACTIVE","bumpedAt":"2026-10-12T09:15:00.123Z","publishedAt":"2026-10-01T10:00:00Z",
    "createdAt":"2026-10-01T09:59:59.000Z"
    """

    func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.decoder().decode(T.self, from: Data(json.utf8))
    }

    func testListingCardDecodesWithFractionalAndPlainDates() throws {
        let c = try decode(ListingCard.self, "{\(Self.card)}")
        XCTAssertEqual(c.price, 185_000)
        XCTAssertEqual(c.area, 92.5)
        XCTAssertEqual(c.dealType, .SALE)
        XCTAssertNil(c.landArea)
        XCTAssertEqual(c.bumpedAt, DateParsing.parse("2026-10-12T09:15:00.123Z"))
        XCTAssertNotNil(c.publishedAt)
    }

    func testListingDetailFlattensCardFields() throws {
        let json = """
        {\(Self.card),"description":"Təmirli, əşyalı mənzil. Metroya 3 dəqiqə.","images":[{"id":"i2","uploadId":"u2","url":"/b","thumbUrl":"/bt","order":1},{"id":"i1","uploadId":"u1","url":"/a","thumbUrl":"/at","order":0}],
        "bathrooms":1,"yearBuilt":2019,"ceilingHeight":3.1,"repair":"EURO","amenities":["BALCONY","FUTURE_AMENITY","WIFI"],
        "maxGuests":null,"minNights":null,"checkInTime":null,"checkOutTime":null,"houseRules":null,"contactName":"Elvin",
        "contactPhoneMasked":"+994 50 123 ** **","contactPhone":null,
        "owner":{"id":"o1","name":"Elvin","avatarUrl":null,"accountType":"INDIVIDUAL","agency":null,"memberSince":"2025-01-01T00:00:00.000Z","activeListings":2,"rating":null,"reviewsCount":0},
        "agency":null,"views":120,"favoritesCount":4,"reviewsCount":0,"expiresAt":null,"rejectionReason":null,"promotions":[],
        "isOwner":false,"isFavorite":true,"updatedAt":"2026-10-12T09:15:00.123Z"}
        """
        let d = try decode(ListingDetail.self, json)
        XCTAssertEqual(d.title, "3 otaqlı mənzil, Nəsimi") // dynamic member → card
        XCTAssertEqual(d.amenities, [.BALCONY, .WIFI]) // unknown amenity skipped
        XCTAssertEqual(d.orderedImages.map(\.uploadId), ["u1", "u2"])
        XCTAssertTrue(d.isFavorite)
        XCTAssertEqual(d.owner.activeListings, 2)
    }

    func testMeDecodesUserPlusExtras() throws {
        let json = """
        {"id":"u1","name":"Aysel","phone":"+994501234567","email":null,"avatarUrl":null,"role":"USER","accountType":"BUSINESS",
        "status":"ACTIVE","locale":"ru","isPhoneVerified":true,"isEmailVerified":false,"agencyId":null,"createdAt":"2026-01-01T00:00:00.000Z",
        "wallet":{"balance":1500,"bonusBalance":250,"currency":"AZN"},"subscription":null,
        "quota":{"freeLimit":2,"used":1,"remaining":1,"listingFee":300},"unreadMessages":3,"unreadNotifications":0}
        """
        let me = try decode(Me.self, json)
        XCTAssertEqual(me.name, "Aysel")
        XCTAssertEqual(me.locale, .ru)
        XCTAssertTrue(me.isBusiness)
        XCTAssertEqual(me.wallet.spendable, 1750)
        XCTAssertEqual(me.quota.remaining, 1)
        XCTAssertNil(me.activeSubscription)
    }

    func testPaginatedAndHasMore() throws {
        let p = try decode(Paginated<Review>.self, """
        {"items":[{"id":"r1","listingId":"l1","bookingId":"b1","author":{"id":"a","name":"Nigar","avatarUrl":null},"rating":5,
        "comment":"Əla idi!","createdAt":"2026-09-01T12:00:00.000Z","hostReply":null}],"total":21,"page":1,"pageSize":20}
        """)
        XCTAssertEqual(p.items.count, 1)
        XCTAssertTrue(p.hasMore)
    }

    func testNullableTopLevelSubscription() throws {
        let s = try decode(Subscription?.self, "null")
        XCTAssertNil(s)
    }

    func testNotificationKeepsUnknownTypeAndData() throws {
        let n = try decode(AppNotification.self, """
        {"id":"n1","type":"SOMETHING_NEW","title":"T","body":"B","data":{"listingId":"l1","count":2},"readAt":null,"createdAt":"2026-10-01T00:00:00Z"}
        """)
        XCTAssertNil(n.kind)
        XCTAssertEqual(n.data["listingId"]?.stringValue, "l1")
        XCTAssertEqual(n.data["count"]?.intValue, 2)
        XCTAssertEqual(DeepLink.from(notificationData: n.data), .listing(id: "l1"))
    }

    func testListingInputEncodesExplicitNulls() throws {
        let input = ListingInput(dealType: .RENT_LONG, propertyType: .APARTMENT, title: "2 otaqlı kirayə mənzil", description: String(repeating: "a", count: 40),
                                 price: 700, cityId: "baku", area: 60, rooms: 2, contactName: "Elvin", contactPhone: "+994501234567", imageIds: ["u1"])
        let obj = try JSONSerialization.jsonObject(with: JSONCoding.encoder().encode(input)) as! [String: Any]
        XCTAssertTrue(obj["districtId"] is NSNull)
        XCTAssertEqual(obj["price"] as? Int, 700)
        XCTAssertEqual(obj["currency"] as? String, "AZN")
        XCTAssertEqual(obj["imageIds"] as? [String], ["u1"])
    }

    func testCheckoutInputDiscriminator() throws {
        let data = try JSONCoding.encoder().encode(CheckoutInput.promotion(listingId: "l1", serviceCodes: nil, bundleCode: "FAST_SALE", method: .WALLET, returnUrl: DeepLink.paymentReturnURL))
        let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(obj["purpose"] as? String, "PROMOTION")
        XCTAssertEqual(obj["bundleCode"] as? String, "FAST_SALE")
        XCTAssertNil(obj["serviceCodes"])
        XCTAssertEqual(obj["returnUrl"] as? String, "evtap://payment/result")

        let topup = try JSONSerialization.jsonObject(with: JSONCoding.encoder().encode(CheckoutInput.walletTopup(amount: 5000, returnUrl: nil))) as! [String: Any]
        XCTAssertEqual(topup["method"] as? String, "CARD")
        XCTAssertEqual(topup["amount"] as? Int, 5000)
    }

    func testUpdateMeAvatarClearing() throws {
        let clear = try JSONSerialization.jsonObject(with: JSONCoding.encoder().encode(UpdateMeInput(avatarUrl: .some(nil)))) as! [String: Any]
        XCTAssertTrue(clear["avatarUrl"] is NSNull)
        let untouched = try JSONSerialization.jsonObject(with: JSONCoding.encoder().encode(UpdateMeInput(name: "Aysel"))) as! [String: Any]
        XCTAssertNil(untouched["avatarUrl"])
    }

    func testDateParsingVariants() {
        XCTAssertNotNil(DateParsing.parse("2026-10-13T14:05:42.123Z"))
        XCTAssertNotNil(DateParsing.parse("2026-10-13T14:05:42Z"))
        XCTAssertNotNil(DateParsing.parse("2026-10-13"))
        XCTAssertNil(DateParsing.parse("13.10.2026"))
    }
}
