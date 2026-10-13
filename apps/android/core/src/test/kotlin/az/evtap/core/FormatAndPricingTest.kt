package az.evtap.core

import az.evtap.core.format.Format
import az.evtap.core.format.Phone
import az.evtap.core.model.BillingPeriod
import az.evtap.core.model.Currency
import az.evtap.core.pricing.DefaultCatalog
import az.evtap.core.pricing.Pricing
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FormatAndPricingTest {
    @Test fun `price and money match the shared web formatting`() {
        assertEquals("125 000 ₼", Format.price(125_000, Currency.AZN))
        assertEquals("950 $", Format.price(950, Currency.USD))
        assertEquals("1 250 000 €", Format.price(1_250_000, Currency.EUR))
        assertEquals("10.50 ₼", Format.money(1050))
        assertEquals("0.05 ₼", Format.money(5))
        assertEquals("1 234.00 ₼", Format.money(123_400))
        assertEquals("-3.00 ₼", Format.money(-300))
    }

    @Test fun `short prices for map markers`() {
        assertEquals("950", Format.shortPrice(950))
        assertEquals("9999", Format.shortPrice(9_999))
        assertEquals("125K", Format.shortPrice(125_000))
        assertEquals("1.3M", Format.shortPrice(1_250_000))
    }

    @Test fun `phone formatting masking and normalisation`() {
        assertEquals("+994 50 123 45 67", Format.phone("+994501234567"))
        assertEquals("+994 50 123 ** **", Format.maskPhone("+994501234567"))
        assertEquals("+994501234567", Phone.normalize("050 123-45-67"))
        assertTrue(Phone.isValid("+995 555 12 34 56"))
        assertFalse(Phone.isValid("+99450123"))
        assertEquals("50 123 45 67", Phone.formatLocal("501234567999"))
        assertEquals("501234567", Phone.toLocalDigits("+994501234567"))
        assertEquals("+994501234567", Phone.fromLocalDigits("50 123 45 67"))
        assertEquals("https://wa.me/994501234567?text=Salam%20d%C3%BCnya", Format.whatsappUrl("+994501234567", "Salam dünya"))
    }

    @Test fun `mortgage annuity and per-m2`() {
        val m = Format.mortgageMonthly(100_000.0, 12.0, 10)
        assertTrue(abs(m - 1434.71) < 0.01, "got $m")
        assertEquals(1000.0, Format.mortgageMonthly(120_000.0, 0.0, 10))
        assertEquals(1_563L, Format.pricePerM2(125_000, 80.0))
        assertEquals(0L, Format.pricePerM2(125_000, 0.0))
    }

    @Test fun `slugify transliterates Azerbaijani letters`() {
        assertEquals("seher-merkezi-3-otaqli", Format.slugify("Şəhər mərkəzi — 3 otaqlı"))
    }

    @Test fun `top-up bonus tiers`() {
        val tiers = DefaultCatalog.settings.topupBonuses
        assertEquals(0L, Pricing.topupBonus(4_999, tiers))
        assertEquals(250L, Pricing.topupBonus(5_000, tiers))
        assertEquals(1_000L, Pricing.topupBonus(10_000, tiers))
        assertEquals(7_500L, Pricing.topupBonus(50_000, tiers))
    }

    @Test fun `booking calculation identical to the server`() {
        assertEquals(3, Pricing.nightsBetween("2026-07-01", "2026-07-04"))
        val p = Pricing.calcBooking(nightlyPriceMajor = 85, nights = 3, guestFeePercent = 8.0, hostFeePercent = 3.0)
        assertEquals(25_500L, p.subtotal)
        assertEquals(2_040L, p.guestFee)
        assertEquals(765L, p.hostFee)
        assertEquals(27_540L, p.total)
        assertEquals(24_735L, p.hostPayout)
    }

    @Test fun `plans bundles and savings`() {
        val pro = DefaultCatalog.plans.first { it.code.name == "PRO" }
        assertEquals(12_900L, Pricing.planPrice(pro, BillingPeriod.MONTH))
        assertEquals(129_000L, Pricing.planPrice(pro, BillingPeriod.YEAR))
        val fast = DefaultCatalog.bundles.first { it.code == "FAST_SALE" }
        assertEquals(700 + 500 + 200 - 1100L, Pricing.bundleSavings(fast, DefaultCatalog.services))
    }
}
