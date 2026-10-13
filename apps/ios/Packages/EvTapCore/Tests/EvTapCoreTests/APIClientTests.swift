import XCTest
@testable import EvTapCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Scripted transport: returns queued responses and records requests.
final class MockTransport: HTTPTransport, @unchecked Sendable {
    struct Canned { let status: Int; let body: String }
    private let lock = NSLock()
    private var queue: [String: [Canned]] = [:]
    private(set) var requests: [URLRequest] = []
    var delayNanos: UInt64 = 0

    func enqueue(_ path: String, _ status: Int, _ body: String) {
        lock.lock(); defer { lock.unlock() }
        queue[path, default: []].append(Canned(status: status, body: body))
    }

    var recorded: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return requests
    }

    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if delayNanos > 0 { try await Task.sleep(nanoseconds: delayNanos) }
        let path = request.url!.path
        let canned: Canned = {
            lock.lock(); defer { lock.unlock() }
            requests.append(request)
            if var q = queue[path], !q.isEmpty {
                let c = q.removeFirst()
                queue[path] = q
                return c
            }
            return Canned(status: 404, body: #"{"statusCode":404,"message":"no mock","code":"NOT_FOUND"}"#)
        }()
        let response = HTTPURLResponse(url: request.url!, statusCode: canned.status, httpVersion: nil, headerFields: nil)!
        return (Data(canned.body.utf8), response)
    }
}

final class APIClientTests: XCTestCase {
    let origin = URL(string: "http://localhost:4000")!
    let authJSON = """
    {"accessToken":"NEW_ACCESS","refreshToken":"NEW_REFRESH","expiresIn":900,"user":{"id":"u1","name":"A","phone":null,"email":null,
    "avatarUrl":null,"role":"USER","accountType":"INDIVIDUAL","status":"ACTIVE","locale":"az","isPhoneVerified":true,
    "isEmailVerified":false,"agencyId":null,"createdAt":"2026-01-01T00:00:00.000Z"}}
    """

    func makeClient(tokens: AuthTokens? = AuthTokens(accessToken: "OLD_ACCESS", refreshToken: "OLD_REFRESH"), transport: MockTransport) -> APIClient {
        APIClient(origin: origin, tokens: TokenManager(store: InMemoryAuthStore(tokens)), transport: transport, language: { "ru" })
    }

    func testBuildsURLWithPrefixAndCSVQuery() throws {
        var f = ListingFilters(dealType: .SALE)
        f.rooms = [3, 1]
        f.propertyType = [.APARTMENT, .HOUSE]
        f.q = "  a+b  "
        let client = makeClient(transport: MockTransport())
        let url = client.url(path: "/listings", query: f.queryParams(page: 2, pageSize: 20))!.absoluteString
        XCTAssertTrue(url.hasPrefix("http://localhost:4000/api/v1/listings?"))
        XCTAssertTrue(url.contains("rooms=1,3"), url)
        XCTAssertTrue(url.contains("propertyType=APARTMENT,HOUSE"), url)
        XCTAssertTrue(url.contains("q=a%2Bb"), url)
        XCTAssertTrue(url.contains("sort=date_desc"), url)
        XCTAssertTrue(url.contains("page=2"), url)
        XCTAssertFalse(url.contains("notFirstFloor"), url)
    }

    func testSendsBearerAndLanguageAndDecodes() async throws {
        let t = MockTransport()
        t.enqueue("/api/v1/conversations/unread-count", 200, #"{"count":4}"#)
        let client = makeClient(transport: t)
        let r = try await client.send(API.unreadCount())
        XCTAssertEqual(r.count, 4)
        let req = t.recorded.first!
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer OLD_ACCESS")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Accept-Language"), "ru")
    }

    func testPublicEndpointNeverSendsToken() async throws {
        let t = MockTransport()
        t.enqueue("/api/v1/catalog", 200, #"{"services":[],"bundles":[],"plans":[],"settings":{"freeListingsPerMonth":2,"listingFee":300,"listingLifetimeDays":30,"dailyRentGuestFeePercent":8,"dailyRentHostFeePercent":3,"freeCancellationHours":48,"topupBonuses":[],"minTopup":100,"maxTopup":500000}}"#)
        _ = try await makeClient(transport: t).send(API.catalog())
        XCTAssertNil(t.recorded.first?.value(forHTTPHeaderField: "Authorization"))
    }

    func testTypedErrorWithCode() async {
        let t = MockTransport()
        t.enqueue("/api/v1/bookings", 409, #"{"statusCode":409,"message":["Dates taken"],"code":"LISTING_NOT_AVAILABLE"}"#)
        let client = makeClient(transport: t)
        do {
            _ = try await client.send(API.createBooking(CreateBookingInput(listingId: "l", checkIn: "2026-10-20", checkOut: "2026-10-22", guests: 2, method: .CARD, returnUrl: nil)))
            XCTFail("expected error")
        } catch let e as APIError {
            XCTAssertEqual(e.status, 409)
            XCTAssertEqual(e.code, .LISTING_NOT_AVAILABLE)
            XCTAssertEqual(e.messages, ["Dates taken"])
            XCTAssertEqual(e.localizationKey, "errors.LISTING_NOT_AVAILABLE")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testRefreshesOnceOn401AndRetries() async throws {
        let t = MockTransport()
        t.enqueue("/api/v1/wallet", 401, #"{"statusCode":401,"message":"expired","code":"TOKEN_INVALID"}"#)
        t.enqueue("/api/v1/auth/refresh", 200, authJSON)
        t.enqueue("/api/v1/wallet", 200, #"{"balance":100,"bonusBalance":0,"currency":"AZN"}"#)
        let client = makeClient(transport: t)
        let w = try await client.send(API.wallet())
        XCTAssertEqual(w.balance, 100)
        let paths = t.recorded.map { $0.url!.path }
        XCTAssertEqual(paths, ["/api/v1/wallet", "/api/v1/auth/refresh", "/api/v1/wallet"])
        XCTAssertEqual(t.recorded.last?.value(forHTTPHeaderField: "Authorization"), "Bearer NEW_ACCESS")
        let refreshBody = try JSONSerialization.jsonObject(with: t.recorded[1].httpBody!) as! [String: String]
        XCTAssertEqual(refreshBody["refreshToken"], "OLD_REFRESH")
        let stored = await client.tokens.current
        XCTAssertEqual(stored?.refreshToken, "NEW_REFRESH")
    }

    func testConcurrent401sShareOneRefresh() async throws {
        let t = MockTransport()
        t.delayNanos = 20_000_000
        for _ in 0..<3 { t.enqueue("/api/v1/wallet", 401, #"{"statusCode":401,"message":"expired"}"#) }
        t.enqueue("/api/v1/auth/refresh", 200, authJSON)
        for _ in 0..<3 { t.enqueue("/api/v1/wallet", 200, #"{"balance":1,"bonusBalance":0,"currency":"AZN"}"#) }
        let client = makeClient(transport: t)
        async let a = client.send(API.wallet())
        async let b = client.send(API.wallet())
        async let c = client.send(API.wallet())
        let results = try await [a, b, c]
        XCTAssertEqual(results.map(\.balance), [1, 1, 1])
        XCTAssertEqual(t.recorded.filter { $0.url!.path == "/api/v1/auth/refresh" }.count, 1)
    }

    func testRejectedRefreshLogsOut() async {
        let t = MockTransport()
        t.enqueue("/api/v1/wallet", 401, #"{"statusCode":401,"message":"expired"}"#)
        t.enqueue("/api/v1/auth/refresh", 401, #"{"statusCode":401,"message":"reused","code":"REFRESH_REUSED"}"#)
        let client = makeClient(transport: t)
        do {
            _ = try await client.send(API.wallet())
            XCTFail("expected 401")
        } catch let e as APIError {
            XCTAssertEqual(e.status, 401)
        } catch {
            XCTFail("unexpected \(error)")
        }
        let signedIn = await client.tokens.isSignedIn
        XCTAssertFalse(signedIn)
    }

    func testRequiredAuthWithoutSessionFailsFast() async {
        let t = MockTransport()
        let client = makeClient(tokens: nil, transport: t)
        do {
            _ = try await client.send(API.wallet())
            XCTFail("expected error")
        } catch let e as APIError {
            XCTAssertTrue(e.isUnauthorized)
            XCTAssertTrue(t.recorded.isEmpty)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testMultipartUpload() async throws {
        let t = MockTransport()
        t.enqueue("/api/v1/uploads", 201, #"{"id":"up1","url":"/uploads/x.webp","thumbUrl":"/uploads/x_t.webp","mime":"image/webp","size":1234}"#)
        let client = makeClient(transport: t)
        let up = try await client.upload(Data([0xFF, 0xD8, 0xFF]))
        XCTAssertEqual(up.id, "up1")
        let req = t.recorded[0]
        XCTAssertTrue(req.value(forHTTPHeaderField: "Content-Type")!.hasPrefix("multipart/form-data; boundary="))
        let body = String(decoding: req.httpBody!, as: UTF8.self)
        XCTAssertTrue(body.contains("name=\"file\"; filename=\"photo.jpg\""))
        XCTAssertEqual(client.mediaURL(up.url)?.absoluteString, "http://localhost:4000/uploads/x.webp")
        XCTAssertEqual(client.mediaURL("https://cdn.evtap.az/a.jpg")?.absoluteString, "https://cdn.evtap.az/a.jpg")
    }
}
