package az.evtap.core.format

import az.evtap.core.model.Currency
import java.net.URLEncoder
import java.text.Normalizer
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToLong

/** Port of packages/shared/src/format.ts plus a few mobile helpers. */
object Format {

    /** Groups thousands with a space: 125000 → "125 000". Negative numbers keep their sign. */
    fun groupThousands(value: Long): String {
        val digits = abs(value).toString()
        val sb = StringBuilder()
        digits.forEachIndexed { i, c ->
            if (i > 0 && (digits.length - i) % 3 == 0) sb.append(' ')
            sb.append(c)
        }
        return (if (value < 0) "-" else "") + sb
    }

    /** Format a MAJOR-unit price, e.g. 125000 AZN → "125 000 ₼". */
    fun price(major: Long, currency: Currency): String = "${groupThousands(major)} ${currency.symbol}"

    /** Format a MINOR-unit amount, e.g. 1050 → "10.50 ₼". */
    fun money(minor: Long, currency: Currency = Currency.AZN): String = "${moneyNumber(minor)} ${currency.symbol}"

    /** "10.50" / "1 250.00" — the number part of [money], thousands grouped for big KPI numbers. */
    fun moneyNumber(minor: Long): String {
        val sign = if (minor < 0) "-" else ""
        val a = abs(minor)
        return "$sign${groupThousands(a / 100)}.${(a % 100).toString().padStart(2, '0')}"
    }

    /** Compact price for map markers: 125000 → "125K", 1250000 → "1.3M", 950 → "950". */
    fun shortPrice(n: Long): String = when {
        n >= 1_000_000 -> String.format(java.util.Locale.US, "%.1fM", n / 1_000_000.0)
        n >= 10_000 -> "${(n / 1000.0).roundToLong()}K"
        else -> n.toString()
    }

    /** "+994501234567" → "+994 50 123 45 67". */
    fun phone(e164: String): String {
        val m = Regex("""^\+(\d{3})(\d{2})(\d{3})(\d{2})(\d{2})$""").find(e164) ?: return e164
        val (cc, op, a, b, c) = m.destructured
        return "+$cc $op $a $b $c"
    }

    /** "+994501234567" → "+994 50 123 ** **". */
    fun maskPhone(e164: String): String {
        val m = Regex("""^\+(\d{3})(\d{2})(\d{3})\d{4}$""").find(e164)
        return if (m != null) "+${m.groupValues[1]} ${m.groupValues[2]} ${m.groupValues[3]} ** **" else e164.dropLast(4) + "****"
    }

    fun pricePerM2(price: Long, area: Double): Long = if (area > 0) (price / area).roundToLong() else 0

    /** Annuity mortgage monthly payment (major units). */
    fun mortgageMonthly(principal: Double, annualRatePercent: Double, years: Int): Double {
        val n = years * 12
        if (n <= 0) return 0.0
        val r = annualRatePercent / 100 / 12
        if (r == 0.0) return principal / n
        return principal * r / (1 - (1 + r).pow(-n))
    }

    fun slugify(s: String): String {
        val replaced = s.lowercase()
            .replace('ə', 'e').replace('ı', 'i').replace('ö', 'o').replace('ü', 'u')
            .replace('ğ', 'g').replace('ş', 's').replace('ç', 'c')
        val noMarks = Normalizer.normalize(replaced, Normalizer.Form.NFKD).replace(Regex("\\p{M}+"), "")
        return noMarks.replace(Regex("[^a-z0-9]+"), "-").trim('-').take(80)
    }

    /** Area without a trailing ".0": 85.0 → "85", 85.5 → "85.5". */
    fun area(v: Double): String = if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()

    fun urlEncode(s: String): String = URLEncoder.encode(s, Charsets.UTF_8.name()).replace("+", "%20")

    /** wa.me link (digits only, no "+"). */
    fun whatsappUrl(e164: String, text: String): String = "https://wa.me/${e164.filter { it.isDigit() }}?text=${urlEncode(text)}"
}

/** Phone helpers for the +994 input (Azerbaijan; Georgia numbers +995 are accepted by the API as well). */
object Phone {
    private val E164 = Regex("""^\+99[45]\d{9}$""")

    /** Mirrors phoneSchema: strips spaces/brackets/dashes, "0501234567" → "+994501234567". */
    fun normalize(raw: String): String {
        val v = raw.trim().replace(Regex("[\\s()-]"), "")
        return if (v.startsWith("0") && v.length == 10) "+994" + v.substring(1) else v
    }

    fun isValid(raw: String): Boolean = E164.matches(normalize(raw))

    /** National digits typed after the fixed "+994" prefix → E.164. */
    fun fromLocalDigits(digits: String): String = "+994" + digits.filter { it.isDigit() }.take(9)

    /** "+994501234567" → "501234567". */
    fun toLocalDigits(e164: String?): String = (e164 ?: "").removePrefix("+994").filter { it.isDigit() }.take(9)

    /** "501234567" → "50 123 45 67" (as-you-type mask). */
    fun formatLocal(digits: String): String {
        val d = digits.filter { it.isDigit() }.take(9)
        return listOf(d.take(2), d.drop(2).take(3), d.drop(5).take(2), d.drop(7).take(2)).filter { it.isNotEmpty() }.joinToString(" ")
    }

    /** Valid Azerbaijani mobile in local form (9 digits, operator code 10/50/51/55/60/70/77/99). */
    fun isCompleteLocal(digits: String): Boolean = digits.length == 9 && digits.all { it.isDigit() }
}
