import Foundation

/// Every endpoint of the contract (`packages/shared/src/api.ts`) used by the iOS app, typed by its response.
/// Paths are relative to `/api/v1`.
public enum API {
    public static let prefix = "/api/v1"

    // MARK: Auth

    public static func requestOtp(phone: String) -> Endpoint<OtpRequestResponse> {
        Endpoint(.POST, "/auth/otp/request", body: PhoneBody(phone: phone), auth: .none)
    }

    public static func verifyOtp(_ input: OtpVerifyInput) -> Endpoint<AuthResponse> {
        Endpoint(.POST, "/auth/otp/verify", body: input, auth: .none)
    }

    public static func register(_ input: RegisterInput) -> Endpoint<AuthResponse> {
        Endpoint(.POST, "/auth/register", body: input, auth: .none)
    }

    public static func login(_ input: LoginInput) -> Endpoint<AuthResponse> {
        Endpoint(.POST, "/auth/login", body: input, auth: .none)
    }

    public static func refresh(refreshToken: String) -> Endpoint<AuthResponse> {
        Endpoint(.POST, "/auth/refresh", body: RefreshBody(refreshToken: refreshToken), auth: .none)
    }

    public static func logout(refreshToken: String) -> Endpoint<OkResponse> {
        Endpoint(.POST, "/auth/logout", body: RefreshBody(refreshToken: refreshToken))
    }

    public static func me() -> Endpoint<Me> { Endpoint(.GET, "/auth/me") }

    // MARK: Users

    public static func updateMe(_ input: UpdateMeInput) -> Endpoint<User> { Endpoint(.PATCH, "/users/me", body: input) }

    public static func changePassword(current: String?, new: String) -> Endpoint<OkResponse> {
        Endpoint(.POST, "/users/me/password", body: ChangePasswordInput(currentPassword: current, newPassword: new))
    }

    /// App Store 5.1.1(v): in-app account deletion.
    public static func deleteMe() -> Endpoint<OkResponse> { Endpoint(.DELETE, "/users/me") }

    public static func registerPushToken(_ token: String, platform: DevicePlatform = .ios) -> Endpoint<OkResponse> {
        Endpoint(.POST, "/users/me/push-tokens", body: PushTokenInput(token: token, platform: platform))
    }

    public static func deletePushToken(_ token: String) -> Endpoint<OkResponse> {
        Endpoint(.DELETE, "/users/me/push-tokens/\(seg(token))")
    }

    public static func user(_ id: String) -> Endpoint<PublicUser> { Endpoint(.GET, "/users/\(seg(id))", auth: .none) }

    // MARK: Reference data

    public static func catalog() -> Endpoint<Catalog> { Endpoint(.GET, "/catalog", auth: .none) }
    public static func mortgageBanks() -> Endpoint<[MortgageBank]> { Endpoint(.GET, "/mortgage/banks", auth: .none) }

    public static func mortgageLead(_ input: MortgageLeadInput) -> Endpoint<IdResponse> {
        Endpoint(.POST, "/mortgage/leads", body: input, auth: .optional)
    }

    public static func banners(_ placement: BannerPlacement) -> Endpoint<[Banner]> {
        Endpoint(.GET, "/banners", query: [QueryParam("placement", placement.rawValue)], auth: .none)
    }

    public static func bannerClick(_ id: String) -> Endpoint<OkResponse> {
        Endpoint(.POST, "/banners/\(seg(id))/click", body: EmptyBody(), auth: .none)
    }

    public static func pages(locale: Lang) -> Endpoint<[CmsPageSummary]> {
        Endpoint(.GET, "/pages", query: [QueryParam("locale", locale.rawValue)], auth: .none)
    }

    public static func page(_ slug: String) -> Endpoint<CmsPage> { Endpoint(.GET, "/pages/\(seg(slug))", auth: .none) }

    // MARK: Listings

    public static func listings(_ filters: ListingFilters, page: Int, pageSize: Int = 20) -> Endpoint<Paginated<ListingCard>> {
        Endpoint(.GET, "/listings", query: filters.queryParams(page: page, pageSize: pageSize), auth: .optional)
    }

    public static func featured(_ kind: FeaturedKind, dealType: DealType? = nil, cityId: String? = nil, limit: Int = 12) -> Endpoint<[ListingCard]> {
        var b = QueryBuilder()
        b.add("kind", kind.rawValue)
        b.add("dealType", dealType)
        b.add("cityId", cityId)
        b.add("limit", limit)
        return Endpoint(.GET, "/listings/featured", query: b.params, auth: .optional)
    }

    public static func mapPoints(_ filters: ListingFilters, bbox: BoundingBox) -> Endpoint<[MapPoint]> {
        Endpoint(.GET, "/listings/map", query: filters.queryParams(bbox: bbox.queryValue), auth: .none)
    }

    public static func listing(_ id: String) -> Endpoint<ListingDetail> { Endpoint(.GET, "/listings/\(seg(id))", auth: .optional) }

    public static func revealPhone(_ id: String) -> Endpoint<PhoneResponse> {
        Endpoint(.POST, "/listings/\(seg(id))/phone", body: EmptyBody(), auth: .optional)
    }

    public static func similar(_ id: String) -> Endpoint<[ListingCard]> { Endpoint(.GET, "/listings/\(seg(id))/similar", auth: .optional) }

    public static func reviews(_ listingId: String, page: Int, pageSize: Int = 20) -> Endpoint<Paginated<Review>> {
        Endpoint(.GET, "/listings/\(seg(listingId))/reviews", query: [QueryParam("page", "\(page)"), QueryParam("pageSize", "\(pageSize)")], auth: .none)
    }

    public static func availability(_ listingId: String, from: String, to: String) -> Endpoint<Availability> {
        Endpoint(.GET, "/listings/\(seg(listingId))/availability", query: [QueryParam("from", from), QueryParam("to", to)], auth: .none)
    }

    public static func setAvailability(_ listingId: String, blockedDates: [String]) -> Endpoint<Availability> {
        Endpoint(.PUT, "/listings/\(seg(listingId))/availability", body: AvailabilityInput(blockedDates: blockedDates))
    }

    public static func listingStats(_ id: String) -> Endpoint<ListingStats> { Endpoint(.GET, "/listings/\(seg(id))/stats") }
    public static func createListing(_ input: ListingInput) -> Endpoint<MyListing> { Endpoint(.POST, "/listings", body: input) }

    public static func updateListing(_ id: String, _ input: ListingInput) -> Endpoint<MyListing> {
        Endpoint(.PATCH, "/listings/\(seg(id))", body: input)
    }

    public static func listingAction(_ id: String, _ action: ListingAction) -> Endpoint<MyListing> {
        Endpoint(.POST, "/listings/\(seg(id))/actions", body: ListingActionBody(action: action))
    }

    public static func deleteListing(_ id: String) -> Endpoint<OkResponse> { Endpoint(.DELETE, "/listings/\(seg(id))") }

    public static func reportListing(_ id: String, _ input: ReportInput) -> Endpoint<OkResponse> {
        Endpoint(.POST, "/listings/\(seg(id))/report", body: input, auth: .optional)
    }

    public static func applyCredit(_ id: String, _ credit: CreditKind) -> Endpoint<MyListing> {
        Endpoint(.POST, "/listings/\(seg(id))/apply-credit", body: ApplyCreditBody(credit: credit))
    }

    public static func myListings(status: ListingStatus?, page: Int, pageSize: Int = 20) -> Endpoint<Paginated<MyListing>> {
        var b = QueryBuilder()
        b.add("status", status)
        b.add("page", page)
        b.add("pageSize", pageSize)
        return Endpoint(.GET, "/me/listings", query: b.params)
    }

    // MARK: Favorites & saved searches

    public static func favorites(page: Int, pageSize: Int = 20) -> Endpoint<Paginated<ListingCard>> {
        Endpoint(.GET, "/favorites", query: [QueryParam("page", "\(page)"), QueryParam("pageSize", "\(pageSize)")])
    }

    public static func favoriteIds() -> Endpoint<[String]> { Endpoint(.GET, "/favorites/ids") }
    public static func addFavorite(_ listingId: String) -> Endpoint<OkResponse> { Endpoint(.POST, "/favorites/\(seg(listingId))", body: EmptyBody()) }
    public static func removeFavorite(_ listingId: String) -> Endpoint<OkResponse> { Endpoint(.DELETE, "/favorites/\(seg(listingId))") }
    public static func savedSearches() -> Endpoint<[SavedSearch]> { Endpoint(.GET, "/saved-searches") }
    public static func createSavedSearch(_ input: SavedSearchInput) -> Endpoint<SavedSearch> { Endpoint(.POST, "/saved-searches", body: input) }

    public static func updateSavedSearch(_ id: String, _ patch: SavedSearchPatch) -> Endpoint<SavedSearch> {
        Endpoint(.PATCH, "/saved-searches/\(seg(id))", body: patch)
    }

    public static func deleteSavedSearch(_ id: String) -> Endpoint<OkResponse> { Endpoint(.DELETE, "/saved-searches/\(seg(id))") }

    // MARK: Messaging

    public static func conversations(page: Int, pageSize: Int = 30) -> Endpoint<Paginated<Conversation>> {
        Endpoint(.GET, "/conversations", query: [QueryParam("page", "\(page)"), QueryParam("pageSize", "\(pageSize)")])
    }

    public static func startConversation(listingId: String, message: String) -> Endpoint<Conversation> {
        Endpoint(.POST, "/conversations", body: StartConversationInput(listingId: listingId, message: message))
    }

    public static func unreadCount() -> Endpoint<CountResponse> { Endpoint(.GET, "/conversations/unread-count") }
    public static func conversation(_ id: String) -> Endpoint<Conversation> { Endpoint(.GET, "/conversations/\(seg(id))") }

    public static func messages(_ conversationId: String, before: String? = nil, limit: Int = 50) -> Endpoint<[Message]> {
        var b = QueryBuilder()
        b.add("before", before)
        b.add("limit", limit)
        return Endpoint(.GET, "/conversations/\(seg(conversationId))/messages", query: b.params)
    }

    public static func sendMessage(_ conversationId: String, body: String) -> Endpoint<Message> {
        Endpoint(.POST, "/conversations/\(seg(conversationId))/messages", body: MessageBody(body: body))
    }

    public static func markRead(_ conversationId: String) -> Endpoint<OkResponse> {
        Endpoint(.POST, "/conversations/\(seg(conversationId))/read", body: EmptyBody())
    }

    // MARK: Bookings

    public static func quote(_ input: BookingQuoteInput) -> Endpoint<BookingQuote> {
        Endpoint(.POST, "/bookings/quote", body: input, auth: .optional)
    }

    public static func createBooking(_ input: CreateBookingInput) -> Endpoint<CreateBookingResponse> {
        Endpoint(.POST, "/bookings", body: input)
    }

    public static func bookings(role: BookingRole, status: BookingStatus? = nil, page: Int, pageSize: Int = 20) -> Endpoint<Paginated<Booking>> {
        var b = QueryBuilder()
        b.add("role", role)
        b.add("status", status)
        b.add("page", page)
        b.add("pageSize", pageSize)
        return Endpoint(.GET, "/bookings", query: b.params)
    }

    public static func booking(_ id: String) -> Endpoint<Booking> { Endpoint(.GET, "/bookings/\(seg(id))") }

    /// Resume payment of a PENDING_PAYMENT booking whose hold has not expired.
    public static func payBooking(_ id: String, method: PaymentMethod, returnUrl: String?) -> Endpoint<CheckoutResponse> {
        Endpoint(.POST, "/bookings/\(seg(id))/pay", body: PayBookingInput(method: method, returnUrl: returnUrl))
    }

    public static func cancelBooking(_ id: String, reason: String?) -> Endpoint<Booking> {
        Endpoint(.POST, "/bookings/\(seg(id))/cancel", body: CancelBookingInput(reason: reason))
    }

    public static func reviewBooking(_ id: String, _ input: ReviewInput) -> Endpoint<Review> {
        Endpoint(.POST, "/bookings/\(seg(id))/review", body: input)
    }

    public static func replyReview(_ reviewId: String, reply: String) -> Endpoint<Review> {
        Endpoint(.POST, "/reviews/\(seg(reviewId))/reply", body: ReviewReplyInput(reply: reply))
    }

    // MARK: Payments, wallet, subscriptions

    public static func checkout(_ input: CheckoutInput) -> Endpoint<CheckoutResponse> { Endpoint(.POST, "/checkout", body: input) }

    public static func payments(page: Int, pageSize: Int = 30) -> Endpoint<Paginated<Payment>> {
        Endpoint(.GET, "/payments", query: [QueryParam("page", "\(page)"), QueryParam("pageSize", "\(pageSize)")])
    }

    public static func payment(_ id: String) -> Endpoint<Payment> { Endpoint(.GET, "/payments/\(seg(id))") }
    public static func wallet() -> Endpoint<Wallet> { Endpoint(.GET, "/wallet") }

    public static func walletTransactions(page: Int, pageSize: Int = 30) -> Endpoint<Paginated<WalletTransaction>> {
        Endpoint(.GET, "/wallet/transactions", query: [QueryParam("page", "\(page)"), QueryParam("pageSize", "\(pageSize)")])
    }

    public static func subscription() -> Endpoint<Subscription?> { Endpoint(.GET, "/subscriptions/me") }
    public static func cancelSubscription() -> Endpoint<Subscription> { Endpoint(.POST, "/subscriptions/me/cancel", body: EmptyBody()) }
    public static func resumeSubscription() -> Endpoint<Subscription> { Endpoint(.POST, "/subscriptions/me/resume", body: EmptyBody()) }

    // MARK: Agencies

    public static func agency(slug: String) -> Endpoint<Agency> { Endpoint(.GET, "/agencies/\(seg(slug))", auth: .none) }
    public static func createAgency(_ input: AgencyInput) -> Endpoint<Agency> { Endpoint(.POST, "/agencies", body: input) }
    public static func myAgency() -> Endpoint<Agency> { Endpoint(.GET, "/agencies/me") }
    public static func updateMyAgency(_ input: AgencyInput) -> Endpoint<Agency> { Endpoint(.PATCH, "/agencies/me", body: input) }

    public static func agencyStats(days: Int = 30) -> Endpoint<AgencyStats> {
        Endpoint(.GET, "/agencies/me/stats", query: [QueryParam("days", "\(days)")])
    }

    // MARK: Notifications

    public static func notifications(page: Int, pageSize: Int = 30) -> Endpoint<Paginated<AppNotification>> {
        Endpoint(.GET, "/notifications", query: [QueryParam("page", "\(page)"), QueryParam("pageSize", "\(pageSize)")])
    }

    public static func readNotification(_ id: String) -> Endpoint<OkResponse> {
        Endpoint(.POST, "/notifications/\(seg(id))/read", body: EmptyBody())
    }

    public static func readAllNotifications() -> Endpoint<OkResponse> { Endpoint(.POST, "/notifications/read-all", body: EmptyBody()) }
}
