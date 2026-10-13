package az.evtap.core

import az.evtap.core.booking.DateRange
import az.evtap.core.booking.DayState
import az.evtap.core.booking.HostCalendar
import az.evtap.core.booking.MonthGrid
import az.evtap.core.booking.NightAvailability
import az.evtap.core.listing.DraftPhoto
import az.evtap.core.listing.ListingDraft
import az.evtap.core.listing.PhotoOrder
import az.evtap.core.locations.Locations
import az.evtap.core.markdown.Markdown
import az.evtap.core.markdown.MdBlock
import az.evtap.core.markdown.MdInline
import az.evtap.core.model.*
import az.evtap.core.validation.FieldError
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import java.io.File
import java.time.LocalDate
import java.time.YearMonth
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DomainLogicTest {
    private val validDraft = ListingDraft(
        dealType = DealType.SALE, propertyType = PropertyType.APARTMENT, buildingType = BuildingType.NEW, cityId = "baku",
        area = "85,5", rooms = "3", floor = "5", totalFloors = "12",
        photos = listOf(DraftPhoto("k1", uploadId = "11111111-1111-1111-1111-111111111111", progress = 1f)),
        price = "185000", title = "3 otaqlı mənzil, Nəsimi r.", description = "Təmirli, mebelli, metroya 5 dəqiqə. Sənədləri qaydasındadır.",
        contactName = "Elvin", contactPhone = "501234567",
    )

    @Test fun `a complete draft validates and serialises with explicit nulls`() {
        assertEquals(emptyMap(), validDraft.validate())
        val json = validDraft.toJson()
        assertEquals(JsonPrimitive(85.5), json["area"])
        assertEquals(JsonPrimitive(185000L), json["price"])
        assertEquals(JsonPrimitive("+994501234567"), json["contactPhone"])
        assertEquals(JsonNull, json["maxGuests"]) // not daily rent
        assertEquals(JsonNull, json["districtId"])
        assertEquals(1, json["imageIds"]!!.jsonArray.size)
    }

    @Test fun `draft validation mirrors createListingSchema refinements`() {
        val e = validDraft.copy(floor = "13", title = "short", photos = emptyList(), contactPhone = "12").validate()
        assertEquals(FieldError.FloorAboveTotal, e["floor"])
        assertEquals(FieldError.MinLength(10), e["title"])
        assertEquals(FieldError.PhotosRequired, e["imageIds"])
        assertEquals(FieldError.InvalidPhone, e["contactPhone"])
        assertEquals(2, ListingDraft.firstStepWithError(e))

        val daily = validDraft.copy(dealType = DealType.RENT_DAILY, maxGuests = "").validate()
        assertEquals(FieldError.Required, daily["maxGuests"])
        val rooms = validDraft.copy(rooms = "").validate()
        assertEquals(FieldError.Required, rooms["rooms"])
        val office = validDraft.copy(propertyType = PropertyType.OFFICE, rooms = "").validate()
        assertNull(office["rooms"])
        assertIs<FieldError.InvalidNumber>(validDraft.copy(area = "abc").validate()["area"])
    }

    @Test fun `edit mode keeps upload ids and own phone`() {
        val detail = ListingDetail(
            id = "l1", title = "Title long enough", dealType = DealType.RENT_DAILY, price = 90, area = 60.0, maxGuests = 4,
            images = listOf(ListingImage("i2", "u2", "/u2.webp", "/u2t.webp", 1), ListingImage("i1", null, "/u1.webp", "", 0)),
            contactName = "Aysel", contactPhone = "+994551112233",
        )
        val d = ListingDraft.fromListing(detail, fallbackPhone = null)
        assertEquals(listOf("i1", "u2"), d.photos.map { it.uploadId })
        assertEquals("551112233", d.contactPhone)
        assertEquals("60", d.area)
        assertEquals("4", d.maxGuests)
    }

    @Test fun `photo reordering`() {
        val ps = listOf("a", "b", "c").map { DraftPhoto(it) }
        assertEquals(listOf("c", "a", "b"), PhotoOrder.makeCover(ps, 2).map { it.key })
        assertEquals(listOf("b", "a", "c"), PhotoOrder.move(ps, 0, 1).map { it.key })
        assertEquals(ps, PhotoOrder.move(ps, 0, 5))
    }

    @Test fun `booking range selection respects unavailable nights`() {
        val today = LocalDate.parse("2026-07-01")
        val nights = NightAvailability(Availability("l", blockedDates = listOf("2026-07-10"), bookedRanges = listOf(BookedRange("2026-07-04", "2026-07-06"))))
        assertFalse(nights.isNightFree(LocalDate.parse("2026-07-04")))
        assertFalse(nights.isNightFree(LocalDate.parse("2026-07-05")))
        assertTrue(nights.isNightFree(LocalDate.parse("2026-07-06"))) // check-out day is free

        var r = DateRange().tap(LocalDate.parse("2026-07-02"), today, nights)
        assertEquals(DayState.SINGLE, r.stateOf(LocalDate.parse("2026-07-02"), today, nights))
        // check-out on the first booked day is allowed (night of 07-03 is free)
        assertEquals(DayState.NORMAL, r.stateOf(LocalDate.parse("2026-07-04"), today, nights))
        r = r.tap(LocalDate.parse("2026-07-04"), today, nights)
        assertTrue(r.complete)
        assertEquals(2, r.nights)
        // crossing booked nights restarts the selection instead
        val crossing = DateRange(LocalDate.parse("2026-07-02")).tap(LocalDate.parse("2026-07-08"), today, nights)
        assertEquals(DateRange(LocalDate.parse("2026-07-08")), crossing)
        // past days are ignored
        assertEquals(DateRange(), DateRange().tap(LocalDate.parse("2026-06-30"), today, nights))
        assertEquals(DayState.PAST, DateRange().stateOf(LocalDate.parse("2026-06-30"), today))
        assertEquals(DayState.UNAVAILABLE, DateRange().stateOf(LocalDate.parse("2026-07-10"), today, nights))
    }

    @Test fun `host calendar toggling`() {
        val today = LocalDate.parse("2026-07-01")
        val booked = setOf(LocalDate.parse("2026-07-05"))
        var blocked = HostCalendar.toggle(emptySet(), LocalDate.parse("2026-07-03"), today, booked)
        assertEquals(setOf(LocalDate.parse("2026-07-03")), blocked)
        blocked = HostCalendar.toggle(blocked, LocalDate.parse("2026-07-05"), today, booked)
        assertEquals(1, blocked.size)
        blocked = HostCalendar.toggle(blocked, LocalDate.parse("2026-07-03"), today, booked)
        assertTrue(blocked.isEmpty())
        assertEquals(DayState.BOOKED, HostCalendar.stateOf(LocalDate.parse("2026-07-05"), today, blocked, booked))
    }

    @Test fun `month grid starts on Monday`() {
        val weeks = MonthGrid.weeks(YearMonth.of(2026, 10)) // 1 Oct 2026 is a Thursday
        assertEquals(listOf(null, null, null), weeks.first().take(3))
        assertEquals(LocalDate.parse("2026-10-01"), weeks.first()[3])
        assertTrue(weeks.all { it.size == 7 })
    }

    @Test fun `bundled locations asset parses and resolves labels`() {
        val path = System.getProperty("evtap.locationsJson") ?: "../app/src/main/assets/locations.json"
        val loc = Locations.parse(File(path).readText())
        assertTrue(loc.cities.size >= 20)
        val baku = assertNotNull(loc.city("baku"))
        assertEquals("Баку", baku.name.get(AppLocale.RU))
        assertTrue(loc.districtsOf("baku").any { it.id == "baku-nasimi" })
        assertTrue(loc.metrosOf("baku").all { it.cityId == "baku" })
        assertEquals("Nəsimi r., Bakı", loc.label("baku", "baku-nasimi", null, AppLocale.AZ))
        assertTrue(loc.popularCities.any { it.id == "gabala" })
    }

    @Test fun `markdown blocks and inline spans`() {
        val md = """
            # Haqqımızda

            EvTap — **daşınmaz əmlak** platforması. Ətraflı: [sayt](https://evtap.az).

            - Satış
            - Kirayə
            1. Bir
            2. İki

            > Sitat
            ---
        """.trimIndent()
        val blocks = Markdown.parse(md)
        assertEquals(MdBlock.Heading(1, listOf(MdInline.Text("Haqqımızda"))), blocks[0])
        val p = assertIs<MdBlock.Paragraph>(blocks[1])
        assertTrue(p.inline.contains(MdInline.Text("daşınmaz əmlak", bold = true)))
        assertTrue(p.inline.contains(MdInline.Link("sayt", "https://evtap.az")))
        assertEquals(MdBlock.ListBlock(false, listOf(listOf(MdInline.Text("Satış")), listOf(MdInline.Text("Kirayə")))), blocks[2])
        assertTrue((blocks[3] as MdBlock.ListBlock).ordered)
        assertIs<MdBlock.Quote>(blocks[4])
        assertEquals(MdBlock.Rule, blocks[5])
        // unclosed markers stay literal
        assertEquals(listOf(MdInline.Text("2 * 3 = 6")), Markdown.inline("2 * 3 = 6"))
    }
}
