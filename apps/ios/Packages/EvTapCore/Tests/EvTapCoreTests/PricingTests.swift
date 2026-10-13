import XCTest
@testable import EvTapCore

final class PricingTests: XCTestCase {
    func testCalcBookingMatchesSharedImplementation() {
        // calcBooking(80, 3) with 8% / 3% → subtotal 24000, guestFee 1920, hostFee 720
        let b = Pricing.calcBooking(nightlyPriceMajor: 80, nights: 3, settings: Catalog.fallback.settings)
        XCTAssertEqual(b.subtotal, 24_000)
        XCTAssertEqual(b.guestFee, 1_920)
        XCTAssertEqual(b.hostFee, 720)
        XCTAssertEqual(b.total, 25_920)
        XCTAssertEqual(b.hostPayout, 23_280)
    }

    func testCalcBookingRoundsHalfUpLikeMathRound() {
        // subtotal 100 qəpik: 2.5% = 2.5 → 3, 0.5% = 0.5 → 1 (JS Math.round)
        let b = Pricing.calcBooking(nightlyPriceMajor: 1, nights: 1, guestFeePercent: 2.5, hostFeePercent: 0.5)
        XCTAssertEqual(b.guestFee, 3) // 2.5 → 3 (half up)
        XCTAssertEqual(b.hostFee, 1) // 0.5 → 1
    }

    func testTopupBonusTiers() {
        let tiers = Catalog.fallback.settings.topupBonuses
        XCTAssertEqual(Pricing.topupBonus(amount: 4_999, tiers: tiers), 0)
        XCTAssertEqual(Pricing.topupBonus(amount: 5_000, tiers: tiers), 250)
        XCTAssertEqual(Pricing.topupBonus(amount: 10_000, tiers: tiers), 1_000)
        XCTAssertEqual(Pricing.topupBonus(amount: 30_000, tiers: tiers), 4_500)
        XCTAssertEqual(Pricing.topupBonus(amount: 12_345, tiers: tiers), 1_234) // floor
        XCTAssertEqual(Pricing.topupTier(amount: 12_345, tiers: tiers)?.bonusPercent, 10)
    }

    func testPlanPriceAndBundleSaving() {
        let catalog = Catalog.fallback
        let pro = catalog.plans.first { $0.code == .PRO }!
        XCTAssertEqual(pro.price(for: .MONTH), 12_900)
        XCTAssertEqual(pro.price(for: .YEAR), 129_000)
        let fast = catalog.bundles.first { $0.code == "FAST_SALE" }!
        XCTAssertEqual(catalog.listPrice(of: fast), 700 + 500 + 200)
        XCTAssertLessThan(fast.price, catalog.listPrice(of: fast))
    }

    func testISODayArithmetic() {
        XCTAssertEqual(ISODay.nightsBetween("2026-10-13", "2026-10-16"), 3)
        XCTAssertEqual(ISODay.adding(1, to: "2026-12-31"), "2027-01-01")
        XCTAssertEqual(ISODay.adding(-1, to: "2026-03-01"), "2026-02-28")
        XCTAssertEqual(ISODay.daysInMonth(year: 2028, month: 2), 29)
        XCTAssertEqual(ISODay.weekdayMondayFirst("2026-10-12"), 0) // Monday
        XCTAssertEqual(ISODay.weekdayMondayFirst("2026-10-18"), 6) // Sunday
        let months = ISODay.months(from: "2026-11-20", count: 3)
        XCTAssertEqual(months.map(\.month), [11, 12, 1])
        XCTAssertEqual(months.map(\.year), [2026, 2026, 2027])
    }

    func testAvailabilityUnavailableNights() {
        let a = Availability(listingId: "l", blockedDates: ["2026-10-20"],
                             bookedRanges: [.init(checkIn: "2026-10-14", checkOut: "2026-10-16")])
        XCTAssertEqual(a.unavailableNights, ["2026-10-20", "2026-10-14", "2026-10-15"])
        XCTAssertEqual(a.bookedNights, ["2026-10-14", "2026-10-15"])
    }
}
