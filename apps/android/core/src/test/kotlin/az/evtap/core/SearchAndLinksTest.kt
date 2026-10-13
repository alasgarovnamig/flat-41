package az.evtap.core

import az.evtap.core.deeplink.DeepLink
import az.evtap.core.deeplink.DeepLinkParser
import az.evtap.core.model.*
import az.evtap.core.search.BBox
import az.evtap.core.search.ListingFilters
import az.evtap.core.search.MapClustering
import az.evtap.core.search.MapMarker
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SearchAndLinksTest {
    @Test fun `filters serialise to the listingSearchSchema query`() {
        val f = ListingFilters(
            q = "  dəniz  ",
            dealType = DealType.SALE,
            propertyType = setOf(PropertyType.HOUSE, PropertyType.APARTMENT),
            cityId = "baku",
            districtId = setOf("baku-nasimi"),
            rooms = setOf(3, 1),
            priceMin = 200_000,
            priceMax = 100_000, // inverted → swapped
            areaMin = 50.0,
            notFirstFloor = true,
            hasDocument = false,
            amenities = setOf(Amenity.PARKING, Amenity.BALCONY),
            sort = ListingSort.PRICE_ASC,
        )
        val q = f.toQuery()
        assertEquals("dəniz", q["q"])
        assertEquals("APARTMENT,HOUSE", q["propertyType"])
        assertEquals("1,3", q["rooms"])
        assertEquals("100000", q["priceMin"])
        assertEquals("200000", q["priceMax"])
        assertEquals("50", q["areaMin"])
        assertEquals("true", q["notFirstFloor"])
        assertEquals("BALCONY,PARKING", q["amenities"])
        assertEquals("price_asc", q["sort"])
        assertTrue("hasDocument" !in q)
        assertEquals("2", f.toPageQuery(2, 24)["page"])
    }

    @Test fun `active filter count ignores q dealType and sort`() {
        assertEquals(0, ListingFilters(q = "x", dealType = DealType.RENT_DAILY, sort = ListingSort.AREA_DESC).activeCount)
        assertEquals(3, ListingFilters(cityId = "baku", rooms = setOf(2), verified = true).activeCount)
    }

    @Test fun `saved search json round trip`() {
        val f = ListingFilters(dealType = DealType.RENT_DAILY, cityId = "gabala", checkIn = "2026-08-01", checkOut = "2026-08-05", guests = 4,
            rooms = setOf(2, 3), repair = setOf(RepairType.EURO), priceMax = 150)
        val back = ListingFilters.fromJson(f.toJson())
        assertEquals(f.normalized(), back)
    }

    @Test fun `saved search query written by the web as csv strings`() {
        val f = ListingFilters.fromQuery(mapOf("dealType" to "RENT_LONG", "rooms" to "1,2", "hasDocument" to "true", "sort" to "area_desc", "bogus" to "x"))
        assertEquals(DealType.RENT_LONG, f.dealType)
        assertEquals(setOf(1, 2), f.rooms)
        assertTrue(f.hasDocument)
        assertEquals(ListingSort.AREA_DESC, f.sort)
    }

    @Test fun `dates are dropped when the range is invalid`() {
        val f = ListingFilters(checkIn = "2026-08-05", checkOut = "2026-08-01").normalized()
        assertNull(f.checkIn)
        assertNull(f.checkOut)
    }

    @Test fun `bbox query value`() {
        assertEquals("49.70000,40.30000,50.00000,40.50000", BBox(49.7, 40.3, 50.0, 40.5).toQueryValue())
    }

    @Test fun `deep links`() {
        assertEquals(DeepLink.Listing("abc"), DeepLinkParser.parse("evtap://listing/abc"))
        assertEquals(DeepLink.Listing("abc"), DeepLinkParser.parse("https://evtap.az/listing/abc"))
        assertEquals(DeepLink.Listing("abc"), DeepLinkParser.parse("https://www.evtap.az/ru/listing/abc?utm=x"))
        assertEquals(DeepLink.PaymentResult("p1", PaymentStatus.SUCCEEDED), DeepLinkParser.parse("evtap://payment/result?paymentId=p1&status=succeeded"))
        assertEquals(DeepLink.PaymentResult("p2", null), DeepLinkParser.parse("evtap://payment/result?paymentId=p2"))
        assertNull(DeepLinkParser.parse("evtap://payment/result"))
        assertEquals(DeepLink.Search(mapOf("dealType" to "SALE", "cityId" to "baku")), DeepLinkParser.parse("evtap://search?dealType=SALE&cityId=baku"))
        assertEquals(DeepLink.Page("terms"), DeepLinkParser.parse("https://evtap.az/terms"))
        assertEquals(DeepLink.Conversation("c9"), DeepLinkParser.parse("evtap://chat/c9"))
        assertEquals(DeepLink.Wallet, DeepLinkParser.parse("evtap://me/wallet"))
        assertEquals(DeepLink.Home, DeepLinkParser.parse("https://evtap.az/"))
        assertNull(DeepLinkParser.parse("https://example.com/listing/abc"))
        assertNull(DeepLinkParser.parse("not a url"))
    }

    @Test fun `push payload routing`() {
        assertEquals(DeepLink.Conversation("c1"), DeepLinkParser.fromPushData(mapOf("type" to "NEW_MESSAGE", "conversationId" to "c1", "listingId" to "l1")))
        assertEquals(DeepLink.Booking("b1"), DeepLinkParser.fromPushData(mapOf("type" to "BOOKING_NEW", "bookingId" to "b1")))
        assertEquals(DeepLink.Listing("l2"), DeepLinkParser.fromPushData(mapOf("url" to "evtap://listing/l2", "conversationId" to "c1")))
        assertEquals(DeepLink.Notifications, DeepLinkParser.fromPushData(mapOf("type" to "SYSTEM", "notificationId" to "n1")))
    }

    @Test fun `map clustering merges nearby points and keeps far ones apart`() {
        fun p(id: String, lat: Double, lng: Double, price: Long = 100) = MapPoint(id, lat, lng, price)
        val pts = listOf(p("a", 40.4093, 49.8671, 100), p("b", 40.4094, 49.8672, 300), p("c", 40.6828, 46.3606))
        val zoomedOut = MapClustering.cluster(pts, zoom = 10f)
        assertEquals(2, zoomedOut.size)
        val cluster = zoomedOut.filterIsInstance<MapMarker.Cluster>().single()
        assertEquals(2, cluster.count)
        assertEquals(100L, cluster.minPrice)
        assertEquals(300L, cluster.maxPrice)
        assertEquals(3, MapClustering.cluster(pts, zoom = 17f).size)
        assertIs<MapMarker.Single>(MapClustering.cluster(pts.take(1), zoom = 5f).single())
    }
}
