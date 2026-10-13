package az.evtap.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/*
 * Request bodies — mirror of the zod schemas in packages/shared/src/schemas.ts.
 * The shared Json instance uses explicitNulls = false, so `null` optional fields are omitted from the body
 * (PATCH semantics: "not sent" = unchanged). Listing create/update bodies are built explicitly in
 * [az.evtap.core.listing.ListingDraft.toJson] because there `null` must clear a field.
 */

@Serializable data class OtpRequestInput(val phone: String)

@Serializable data class OtpVerifyInput(val phone: String, val code: String, val name: String? = null)

@Serializable data class RegisterInput(val name: String, val email: String, val password: String, val phone: String? = null)

@Serializable data class LoginInput(val login: String, val password: String)

@Serializable data class RefreshInput(val refreshToken: String)

@Serializable
data class UpdateMeInput(val name: String? = null, val email: String? = null, val avatarUrl: String? = null, val locale: AppLocale? = null)

@Serializable data class ChangePasswordInput(val currentPassword: String? = null, val newPassword: String)

@Serializable data class PushTokenInput(val token: String, val platform: String = "android")

@Serializable data class ReportInput(val reason: ReportReason, val comment: String? = null)

@Serializable data class AvailabilityInput(val blockedDates: List<String>)

@Serializable data class SavedSearchInput(val name: String, val query: JsonObject, val notify: Boolean = true)

@Serializable data class SavedSearchPatch(val name: String? = null, val notify: Boolean? = null)

@Serializable data class StartConversationInput(val listingId: String, val message: String)

@Serializable data class SendMessageInput(val body: String)

@Serializable data class BookingQuoteInput(val listingId: String, val checkIn: String, val checkOut: String, val guests: Int)

@Serializable
data class CreateBookingInput(
    val listingId: String,
    val checkIn: String,
    val checkOut: String,
    val guests: Int,
    val method: PaymentMethod,
    val returnUrl: String? = null,
)

@Serializable data class PayBookingInput(val method: PaymentMethod, val returnUrl: String? = null)

@Serializable data class CancelInput(val reason: String? = null)

@Serializable data class ReviewInput(val rating: Int, val comment: String)

@Serializable data class ReviewReplyInput(val reply: String)

/** POST /checkout — discriminated by [purpose]; only the fields of that variant are set. */
@Serializable
data class CheckoutInput(
    val purpose: PaymentPurpose,
    val method: PaymentMethod,
    val amount: Long? = null,
    val listingId: String? = null,
    val serviceCodes: List<String>? = null,
    val bundleCode: String? = null,
    val planCode: PlanCode? = null,
    val period: BillingPeriod? = null,
    val autoRenew: Boolean? = null,
    val returnUrl: String? = null,
) {
    companion object {
        fun topup(amountMinor: Long, returnUrl: String) =
            CheckoutInput(PaymentPurpose.WALLET_TOPUP, PaymentMethod.CARD, amount = amountMinor, returnUrl = returnUrl)

        fun promotion(listingId: String, method: PaymentMethod, returnUrl: String, serviceCodes: List<String>? = null, bundleCode: String? = null) =
            CheckoutInput(PaymentPurpose.PROMOTION, method, listingId = listingId, serviceCodes = serviceCodes?.takeIf { bundleCode == null }, bundleCode = bundleCode, returnUrl = returnUrl)

        fun listingFee(listingId: String, method: PaymentMethod, returnUrl: String) =
            CheckoutInput(PaymentPurpose.LISTING_FEE, method, listingId = listingId, returnUrl = returnUrl)

        fun verification(listingId: String, method: PaymentMethod, returnUrl: String) =
            CheckoutInput(PaymentPurpose.VERIFICATION, method, listingId = listingId, returnUrl = returnUrl)

        fun subscription(plan: PlanCode, period: BillingPeriod, method: PaymentMethod, returnUrl: String, autoRenew: Boolean = true) =
            CheckoutInput(PaymentPurpose.SUBSCRIPTION, method, planCode = plan, period = period, autoRenew = autoRenew, returnUrl = returnUrl)
    }
}

@Serializable data class ApplyCreditInput(val credit: CreditType)

@Serializable data class ListingActionInput(val action: ListingAction)

@Serializable
data class AgencyInput(
    val name: String,
    val type: AgencyType,
    val description: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val website: String? = null,
    val address: String? = null,
    val cityId: String? = null,
    val logoUrl: String? = null,
)

@Serializable data class AddMemberInput(val login: String)

@Serializable
data class MortgageLeadInput(
    val name: String,
    val phone: String,
    val listingId: String? = null,
    val price: Long,
    val downPayment: Long,
    val termYears: Int,
    val bankCode: String? = null,
)
