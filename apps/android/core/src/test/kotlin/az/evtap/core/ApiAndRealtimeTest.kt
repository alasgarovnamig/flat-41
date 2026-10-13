package az.evtap.core

import az.evtap.core.api.ApiClient
import az.evtap.core.api.ApiException
import az.evtap.core.api.EvTapJson
import az.evtap.core.api.UserMessage
import az.evtap.core.api.toUserMessage
import az.evtap.core.model.*
import az.evtap.core.realtime.Backoff
import az.evtap.core.realtime.RealtimeEvent
import az.evtap.core.realtime.RealtimeProtocol
import az.evtap.core.realtime.Throttle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import java.io.IOException
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Exercises the Retrofit contract end-to-end against canned OkHttp responses (no network). */
class ApiAndRealtimeTest {
    private class Canned(var code: Int = 200, var body: String = "{}", var fail: Boolean = false) {
        val requests = mutableListOf<Request>()
        val client: OkHttpClient = OkHttpClient.Builder().addInterceptor { chain ->
            val req = chain.request()
            requests += req
            if (fail) throw IOException("offline")
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("canned")
                .body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
    }

    private fun Request.bodyText(): String = Buffer().also { body?.writeTo(it) }.readUtf8()

    @Test fun `decodes DTOs and builds urls from the contract`() = runTest {
        val c = Canned(body = """{"items":[{"id":"l1","title":"Mənzil","dealType":"RENT_DAILY","price":90,"currency":"AZN","pricePeriod":"DAY",
            "area":55.5,"rating":4.8,"isVip":true,"status":"ACTIVE","unknownField":1}],"total":41,"page":1,"pageSize":20}""")
        val api = ApiClient.create("http://10.0.2.2:4000/", c.client)
        val page = api.call { listings(mapOf("dealType" to "RENT_DAILY", "page" to "1")) }
        assertEquals(41, page.total)
        assertTrue(page.hasMore)
        val l = page.items.single()
        assertEquals(DealType.RENT_DAILY, l.dealType)
        assertEquals(PricePeriod.DAY, l.pricePeriod)
        assertEquals(55.5, l.area)
        assertTrue(l.isVip)
        assertEquals("http://10.0.2.2:4000/api/v1/listings?dealType=RENT_DAILY&page=1", c.requests.single().url.toString())
    }

    @Test fun `request bodies omit nulls and use wire names`() = runTest {
        val c = Canned(body = """{"paymentId":"p1","status":"PENDING","amount":1500,"currency":"AZN","paymentUrl":"https://bank/pay"}""")
        val api = ApiClient.create("https://api.evtap.az", c.client)
        val res = api.call { checkout(CheckoutInput.promotion("l1", PaymentMethod.CARD, "evtap://payment/result", bundleCode = "FAST_SALE", serviceCodes = listOf("VIP_7"))) }
        assertEquals("https://bank/pay", res.paymentUrl)
        val sent = EvTapJson.parseToJsonElement(c.requests.single().bodyText()).jsonObject
        assertEquals(JsonPrimitive("PROMOTION"), sent["purpose"])
        assertEquals(JsonPrimitive("FAST_SALE"), sent["bundleCode"])
        assertNull(sent["serviceCodes"]) // bundle wins
        assertNull(sent["amount"])
        assertEquals("POST", c.requests.single().method)
        assertEquals("https://api.evtap.az/api/v1/checkout", c.requests.single().url.toString())
    }

    @Test fun `api errors carry status code and messages`() = runTest {
        val c = Canned(code = 400, body = """{"statusCode":400,"message":["title must be longer","price must be positive"],"code":"VALIDATION_ERROR"}""")
        val api = ApiClient.create("https://api.evtap.az", c.client)
        val e = assertFailsWith<ApiException> { api.call { me() } }
        assertEquals(400, e.status)
        assertEquals("VALIDATION_ERROR", e.code)
        assertEquals(UserMessage.Server("title must be longer\nprice must be positive"), e.toUserMessage())

        c.code = 402; c.body = """{"statusCode":402,"message":"Not enough money","code":"INSUFFICIENT_FUNDS"}"""
        assertEquals(UserMessage.Code("INSUFFICIENT_FUNDS"), assertFailsWith<ApiException> { api.call { wallet() } }.toUserMessage())

        c.code = 409; c.body = """{"statusCode":409,"message":"You cannot book your own listing","code":"OWN_LISTING","error":"Conflict"}"""
        assertEquals(UserMessage.Code("OWN_LISTING"), assertFailsWith<ApiException> { api.call { wallet() } }.toUserMessage())

        c.code = 503; c.body = "<html>"
        assertEquals(UserMessage.ServerError, assertFailsWith<ApiException> { api.call { wallet() } }.toUserMessage())

        c.fail = true
        val net = assertFailsWith<ApiException> { api.call { wallet() } }
        assertTrue(net.isNetwork)
        assertEquals(UserMessage.Network, net.toUserMessage())
    }

    @Test fun `nullable subscription endpoint`() = runTest {
        val c = Canned(body = "null")
        val api = ApiClient.create("https://api.evtap.az", c.client)
        assertNull(api.mySubscription())
        c.body = ""
        assertNull(api.mySubscription())
        c.body = """{"id":"s1","planCode":"PRO","period":"YEAR","status":"CANCELLED","autoRenew":false,"usage":{"bumpsLeft":7}}"""
        val s = api.mySubscription()!!
        assertEquals(PlanCode.PRO, s.planCode)
        assertEquals(7, s.usage.bumpsLeft)
    }

    @Test fun `unknown enum values fall back to defaults instead of crashing`() {
        val n = EvTapJson.decodeFromString(AppNotification.serializer(), """{"id":"n1","type":"SOMETHING_NEW","title":"x"}""")
        assertEquals(NotificationType.SYSTEM, n.type)
    }

    @Test fun `realtime frames`() {
        val m = RealtimeProtocol.parse("""{"event":"message:new","data":{"id":"m1","conversationId":"c1","senderId":"u2","body":"Salam","createdAt":"2026-10-01T10:00:00Z","readAt":null}}""")
        assertEquals("Salam", assertIs<RealtimeEvent.MessageNew>(m).message.body)
        assertEquals(RealtimeEvent.Ping, RealtimeProtocol.parse("""{"event":"ping"}"""))
        assertEquals(RealtimeEvent.Typing("c1", "u2"), RealtimeProtocol.parse("""{"event":"typing","data":{"conversationId":"c1","userId":"u2"}}"""))
        assertEquals(RealtimeEvent.ConversationRead("c1", "u1", "2026-10-01T10:00:00Z"),
            RealtimeProtocol.parse("""{"event":"conversation:read","data":{"conversationId":"c1","readerId":"u1","readAt":"2026-10-01T10:00:00Z"}}"""))
        assertIs<RealtimeEvent.PaymentUpdated>(RealtimeProtocol.parse("""{"event":"payment:updated","data":{"id":"p1","purpose":"WALLET_TOPUP","status":"SUCCEEDED"}}"""))
        assertEquals(RealtimeEvent.Unknown("future"), RealtimeProtocol.parse("""{"event":"future","data":1}"""))
        assertNull(RealtimeProtocol.parse("garbage"))
        assertEquals("""{"event":"typing","data":{"conversationId":"c1"}}""", RealtimeProtocol.typing("c1"))
        assertEquals("ws://10.0.2.2:4000/ws?token=a.b%2Bc", RealtimeProtocol.socketUrl("http://10.0.2.2:4000/", "a.b+c"))
        assertEquals("wss://api.evtap.az/ws?token=t", RealtimeProtocol.socketUrl("https://api.evtap.az", "t"))
    }

    @Test fun `back-off grows to 30 s and resets`() {
        val b = Backoff(jitter = 0.0, random = Random(1))
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L), List(7) { b.nextDelayMs() })
        b.reset()
        assertEquals(1_000L, b.nextDelayMs())
        val jittered = Backoff(random = Random(7))
        repeat(20) { assertTrue(jittered.nextDelayMs() in 500L..30_000L) }
    }

    @Test fun `typing throttle`() {
        var now = 0L
        val t = Throttle(1_000) { now }
        assertTrue(t.tryAcquire())
        now = 500
        assertFalse(t.tryAcquire())
        now = 1_000
        assertTrue(t.tryAcquire())
    }
}
