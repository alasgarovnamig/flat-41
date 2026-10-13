package az.evtap.core.api

import az.evtap.core.model.*
import kotlinx.serialization.json.JsonObject
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.QueryMap

/**
 * The API contract (packages/shared/src/api.ts) as a Retrofit interface. Base URL: `${API_URL}/api/v1/`.
 * Auth header, Accept-Language and the 401 → refresh → retry flow are added by OkHttp interceptors in :app.
 * Only the endpoints the mobile app uses are declared (admin endpoints are web-only).
 */
interface EvTapApi {
    // ── Auth
    @POST("auth/otp/request") suspend fun requestOtp(@Body body: OtpRequestInput): OtpRequestResult
    @POST("auth/otp/verify") suspend fun verifyOtp(@Body body: OtpVerifyInput): AuthResponse
    @POST("auth/register") suspend fun register(@Body body: RegisterInput): AuthResponse
    @POST("auth/login") suspend fun login(@Body body: LoginInput): AuthResponse
    @POST("auth/refresh") suspend fun refresh(@Body body: RefreshInput): AuthResponse
    @POST("auth/logout") suspend fun logout(@Body body: RefreshInput): Ok
    @GET("auth/me") suspend fun me(): Me

    // ── Users
    @PATCH("users/me") suspend fun updateMe(@Body body: UpdateMeInput): User
    @POST("users/me/password") suspend fun changePassword(@Body body: ChangePasswordInput): Ok
    @DELETE("users/me") suspend fun deleteMe(): Ok
    @POST("users/me/push-tokens") suspend fun registerPushToken(@Body body: PushTokenInput): Ok
    @DELETE("users/me/push-tokens/{token}") suspend fun deletePushToken(@Path("token") token: String): Ok
    @GET("users/{id}") suspend fun user(@Path("id") id: String): PublicUser

    // ── Reference data
    @GET("catalog") suspend fun catalog(): Catalog
    @GET("mortgage/banks") suspend fun mortgageBanks(): List<MortgageBank>
    @POST("mortgage/leads") suspend fun mortgageLead(@Body body: MortgageLeadInput): IdResponse
    @GET("banners") suspend fun banners(@Query("placement") placement: BannerPlacement): List<Banner>
    @POST("banners/{id}/click") suspend fun bannerClick(@Path("id") id: String): Ok
    @GET("pages") suspend fun pages(@Query("locale") locale: String): List<PageSummary>
    @GET("pages/{slug}") suspend fun page(@Path("slug") slug: String): CmsPage

    // ── Uploads
    @Multipart @POST("uploads") suspend fun upload(@Part file: MultipartBody.Part): Upload

    // ── Listings
    @GET("listings") suspend fun listings(@QueryMap query: Map<String, String>): Paginated<ListingCard>
    @GET("listings/featured") suspend fun featured(
        @Query("kind") kind: String,
        @Query("dealType") dealType: DealType? = null,
        @Query("cityId") cityId: String? = null,
        @Query("limit") limit: Int? = null,
    ): List<ListingCard>
    @GET("listings/map") suspend fun map(@QueryMap query: Map<String, String>): List<MapPoint>
    @GET("listings/{id}") suspend fun listing(@Path("id") id: String): ListingDetail
    @POST("listings/{id}/phone") suspend fun revealPhone(@Path("id") id: String): PhoneResponse
    @GET("listings/{id}/similar") suspend fun similar(@Path("id") id: String): List<ListingCard>
    @GET("listings/{id}/reviews") suspend fun reviews(@Path("id") id: String, @Query("page") page: Int = 1, @Query("pageSize") pageSize: Int = 20): Paginated<Review>
    @GET("listings/{id}/availability") suspend fun availability(@Path("id") id: String, @Query("from") from: String, @Query("to") to: String): Availability
    @PUT("listings/{id}/availability") suspend fun setAvailability(@Path("id") id: String, @Body body: AvailabilityInput): Availability
    @GET("listings/{id}/stats") suspend fun listingStats(@Path("id") id: String): ListingStats
    /** Body built by [az.evtap.core.listing.ListingDraft.toJson] (explicit nulls). */
    @POST("listings") suspend fun createListing(@Body body: JsonObject): MyListing
    @PATCH("listings/{id}") suspend fun updateListing(@Path("id") id: String, @Body body: JsonObject): MyListing
    @POST("listings/{id}/actions") suspend fun listingAction(@Path("id") id: String, @Body body: ListingActionInput): MyListing
    @DELETE("listings/{id}") suspend fun deleteListing(@Path("id") id: String): Ok
    @POST("listings/{id}/report") suspend fun reportListing(@Path("id") id: String, @Body body: ReportInput): Ok
    @POST("listings/{id}/apply-credit") suspend fun applyCredit(@Path("id") id: String, @Body body: ApplyCreditInput): MyListing
    @GET("me/listings") suspend fun myListings(@Query("status") status: ListingStatus?, @Query("page") page: Int, @Query("pageSize") pageSize: Int = 20): Paginated<MyListing>

    // ── Favorites & saved searches
    @GET("favorites") suspend fun favorites(@Query("page") page: Int, @Query("pageSize") pageSize: Int = 20): Paginated<ListingCard>
    @GET("favorites/ids") suspend fun favoriteIds(): List<String>
    @POST("favorites/{listingId}") suspend fun addFavorite(@Path("listingId") listingId: String): Ok
    @DELETE("favorites/{listingId}") suspend fun removeFavorite(@Path("listingId") listingId: String): Ok
    @GET("saved-searches") suspend fun savedSearches(): List<SavedSearch>
    @POST("saved-searches") suspend fun createSavedSearch(@Body body: SavedSearchInput): SavedSearch
    @PATCH("saved-searches/{id}") suspend fun updateSavedSearch(@Path("id") id: String, @Body body: SavedSearchPatch): SavedSearch
    @DELETE("saved-searches/{id}") suspend fun deleteSavedSearch(@Path("id") id: String): Ok

    // ── Messaging
    @GET("conversations") suspend fun conversations(@Query("page") page: Int, @Query("pageSize") pageSize: Int = 30): Paginated<Conversation>
    @POST("conversations") suspend fun startConversation(@Body body: StartConversationInput): Conversation
    @GET("conversations/unread-count") suspend fun unreadCount(): UnreadCount
    @GET("conversations/{id}") suspend fun conversation(@Path("id") id: String): Conversation
    @GET("conversations/{id}/messages") suspend fun messages(@Path("id") id: String, @Query("before") before: String? = null, @Query("limit") limit: Int = 50): List<Message>
    @POST("conversations/{id}/messages") suspend fun sendMessage(@Path("id") id: String, @Body body: SendMessageInput): Message
    @POST("conversations/{id}/read") suspend fun markRead(@Path("id") id: String): Ok

    // ── Daily-rent bookings
    @POST("bookings/quote") suspend fun quote(@Body body: BookingQuoteInput): BookingQuote
    @POST("bookings") suspend fun createBooking(@Body body: CreateBookingInput): BookingCheckout
    @GET("bookings") suspend fun bookings(@Query("role") role: String, @Query("status") status: BookingStatus? = null, @Query("page") page: Int = 1, @Query("pageSize") pageSize: Int = 20): Paginated<Booking>
    @GET("bookings/{id}") suspend fun booking(@Path("id") id: String): Booking
    @POST("bookings/{id}/pay") suspend fun payBooking(@Path("id") id: String, @Body body: PayBookingInput): CheckoutResponse
    @POST("bookings/{id}/cancel") suspend fun cancelBooking(@Path("id") id: String, @Body body: CancelInput): Booking
    @POST("bookings/{id}/review") suspend fun reviewBooking(@Path("id") id: String, @Body body: ReviewInput): Review
    @POST("reviews/{id}/reply") suspend fun replyReview(@Path("id") id: String, @Body body: ReviewReplyInput): Review

    // ── Payments, wallet, subscriptions
    @POST("checkout") suspend fun checkout(@Body body: CheckoutInput): CheckoutResponse
    @GET("payments") suspend fun payments(@Query("page") page: Int, @Query("pageSize") pageSize: Int = 20): Paginated<Payment>
    @GET("payments/{id}") suspend fun payment(@Path("id") id: String): Payment
    @GET("wallet") suspend fun wallet(): Wallet
    @GET("wallet/transactions") suspend fun walletTransactions(@Query("page") page: Int, @Query("pageSize") pageSize: Int = 20): Paginated<WalletTransaction>
    /** `Subscription | null` — the body may be `null`/empty, so it is decoded by [ApiClient.mySubscription]. */
    @GET("subscriptions/me") suspend fun mySubscriptionRaw(): ResponseBody
    @POST("subscriptions/me/cancel") suspend fun cancelSubscription(): Subscription
    @POST("subscriptions/me/resume") suspend fun resumeSubscription(): Subscription

    // ── Agencies
    @GET("agencies/{slug}") suspend fun agency(@Path("slug") slug: String): Agency
    @POST("agencies") suspend fun createAgency(@Body body: AgencyInput): Agency
    @GET("agencies/me") suspend fun myAgency(): Agency
    @PATCH("agencies/me") suspend fun updateMyAgency(@Body body: AgencyInput): Agency
    @GET("agencies/me/members") suspend fun agencyMembers(): List<AgencyMember>
    @POST("agencies/me/members") suspend fun addAgencyMember(@Body body: AddMemberInput): AgencyMember
    @DELETE("agencies/me/members/{userId}") suspend fun removeAgencyMember(@Path("userId") userId: String): Ok
    @GET("agencies/me/stats") suspend fun agencyStats(@Query("days") days: Int = 30): AgencyStats

    // ── Notifications
    @GET("notifications") suspend fun notifications(@Query("page") page: Int, @Query("pageSize") pageSize: Int = 30): Paginated<AppNotification>
    @POST("notifications/{id}/read") suspend fun readNotification(@Path("id") id: String): Ok
    @POST("notifications/read-all") suspend fun readAllNotifications(): Ok
}
