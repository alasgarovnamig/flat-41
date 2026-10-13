import XCTest
@testable import EvTapCore

final class FormatTests: XCTestCase {
    func testPriceMatchesSharedFormatPrice() {
        XCTAssertEqual(Format.price(125_000, .AZN), "125 000 ₼")
        XCTAssertEqual(Format.price(950, .USD), "950 $")
        XCTAssertEqual(Format.price(1_250_000, .EUR), "1 250 000 €")
        XCTAssertEqual(Format.price(0, .GEL), "0 ₾")
    }

    func testMoneyIsMinorUnitsWithTwoDecimals() {
        XCTAssertEqual(Format.money(1050), "10.50 ₼")
        XCTAssertEqual(Format.money(5), "0.05 ₼")
        XCTAssertEqual(Format.money(123_456_78), "123 456.78 ₼")
        XCTAssertEqual(Format.money(-250), "-2.50 ₼")
    }

    func testPriceParts() {
        let p = Format.priceParts(276_880, .AZN)
        XCTAssertEqual(p.symbol, "₼")
        XCTAssertEqual(p.value, "276 880")
    }

    func testShortPrice() {
        XCTAssertEqual(Format.shortPrice(125_000), "125K")
        XCTAssertEqual(Format.shortPrice(1_250_000), "1.3M")
        XCTAssertEqual(Format.shortPrice(2_000_000), "2M")
        XCTAssertEqual(Format.shortPrice(950), "950")
    }

    func testPhoneFormattingAndMasking() {
        XCTAssertEqual(Format.phone("+994501234567"), "+994 50 123 45 67")
        XCTAssertEqual(Format.maskPhone("+994501234567"), "+994 50 123 ** **")
        XCTAssertEqual(Format.phone("12345"), "12345")
    }

    func testLocalPhoneHelpers() {
        XCTAssertEqual(Format.localDigits("+994501234567"), "501234567")
        XCTAssertEqual(Format.localDigits("0501234567"), "501234567")
        XCTAssertEqual(Format.localPhone("501234567"), "50 123 45 67")
        XCTAssertEqual(Format.localPhone("5012"), "50 12")
        XCTAssertEqual(Format.sanitizeLocalInput("0 (50) 123-45-67"), "501234567")
        XCTAssertEqual(Format.sanitizeLocalInput("+994 50 123 45 67"), "501234567")
    }

    func testMortgageMonthlyAnnuity() {
        // 100 000 at 12% for 10 years ≈ 1434.71
        XCTAssertEqual(Format.mortgageMonthly(principal: 100_000, annualRatePercent: 12, years: 10), 1434.71, accuracy: 0.01)
        XCTAssertEqual(Format.mortgageMonthly(principal: 12_000, annualRatePercent: 0, years: 1), 1000, accuracy: 0.0001)
    }

    func testPricePerM2() {
        XCTAssertEqual(Format.pricePerM2(150_000, area: 75), 2000)
        XCTAssertEqual(Format.pricePerM2(150_000, area: 0), 0)
    }

    func testInterpolation() {
        XCTAssertEqual(Interpolation.apply("{n} nights", ["n": "3"]), "3 nights")
        XCTAssertEqual(Interpolation.apply("floor {floor}/{total}", ["floor": "2", "total": "9"]), "floor 2/9")
        XCTAssertEqual(Interpolation.apply("Keep {unknown}", ["n": "1"]), "Keep {unknown}")
        XCTAssertEqual(Interpolation.apply("no placeholders", [:]), "no placeholders")
    }
}
