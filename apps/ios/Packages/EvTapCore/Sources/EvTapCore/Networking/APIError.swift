import Foundation

/// Stable machine-readable error codes (`ApiError.code`) — mirrors `ERROR_CODES` in `packages/shared/src/api.ts`.
public enum ErrorCode: String, Sendable, CaseIterable {
    case VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, INTERNAL
    case TOKEN_INVALID, REFRESH_INVALID, REFRESH_REUSED, INVALID_CREDENTIALS, INVALID_PASSWORD, USER_EXISTS, EMAIL_TAKEN
    case USER_BLOCKED, USER_NOT_FOUND, OTP_INVALID, OTP_EXPIRED, OTP_TOO_FREQUENT, OTP_TOO_MANY_ATTEMPTS
    case FILE_REQUIRED, FILE_TOO_LARGE, UNSUPPORTED_FILE_TYPE, INVALID_IMAGE, INVALID_IMAGES, INVALID_LOCATION
    case LISTING_BLOCKED, LISTING_NOT_ACTIVE, LISTING_NOT_AVAILABLE, LISTING_NOT_PAID, LISTING_STATUS_INVALID
    case INVALID_STATUS, INVALID_STATUS_TRANSITION, ALREADY_VERIFIED
    case NO_AGENCY, ALREADY_IN_AGENCY, ALREADY_MEMBER, AGENT_LIMIT_REACHED, CANNOT_REMOVE_OWNER, CANNOT_MODIFY_SELF, LIMIT_REACHED
    case CANNOT_MESSAGE_SELF, MESSAGE_EMPTY, RECIPIENT_UNAVAILABLE, INVALID_CURSOR
    case NOT_DAILY_RENT, NOT_BOOKABLE, BOOKING_NOT_CANCELLABLE, BOOKING_ALREADY_STARTED, BOOKING_NOT_COMPLETED, ALREADY_REVIEWED
    case INSUFFICIENT_FUNDS, INVALID_AMOUNT, AMOUNT_OUT_OF_RANGE, CURRENCY_NOT_SUPPORTED, INVALID_SERVICE, INVALID_PLAN
    case NO_SUBSCRIPTION, NO_CREDITS, SUBSCRIPTION_ENDED, RETURN_URL_NOT_ALLOWED, PAYMENT_PROVIDER_UNAVAILABLE
    case INVALID_SIGNATURE, NOT_REFUNDABLE, REFUND_REJECTED, REFUND_AMOUNT_INVALID, FULFILMENT_FAILED
}

/// Error body: `{ statusCode, message: string | string[], error?, code? }`.
struct APIErrorBody: Decodable {
    let statusCode: Int?
    let message: [String]
    let error: String?
    let code: String?

    enum CodingKeys: String, CodingKey { case statusCode, message, error, code }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        statusCode = try c.decodeIfPresent(Int.self, forKey: .statusCode)
        if let many = try? c.decode([String].self, forKey: .message) {
            message = many
        } else if let one = try? c.decode(String.self, forKey: .message) {
            message = [one]
        } else {
            message = []
        }
        error = try c.decodeIfPresent(String.self, forKey: .error)
        code = try c.decodeIfPresent(String.self, forKey: .code)
    }
}

/// Typed API error. `status == 0` means the request never reached the server (offline, DNS, TLS…).
public struct APIError: Error, Sendable, Equatable, CustomStringConvertible {
    public let status: Int
    /// Raw `code` from the body (may be a code this client does not know yet).
    public let rawCode: String?
    public let messages: [String]

    public init(status: Int, code: String? = nil, messages: [String] = []) {
        self.status = status
        self.rawCode = code
        self.messages = messages
    }

    public static let network = APIError(status: 0, code: "NETWORK", messages: ["Network request failed"])
    public static let decoding = APIError(status: -1, code: "DECODING", messages: ["Unexpected response"])

    public var code: ErrorCode? { rawCode.flatMap(ErrorCode.init(rawValue:)) }
    public var isNetwork: Bool { status == 0 }
    public var isUnauthorized: Bool { status == 401 }
    public var isNotFound: Bool { status == 404 || code == .NOT_FOUND }
    public var description: String { "APIError(\(status), \(rawCode ?? "-"), \(messages.joined(separator: "; ")))" }

    /// Localization key for this error: `errors.<CODE>` when known, else a status-based fallback.
    public var localizationKey: String {
        if let code { return "errors.\(code.rawValue)" }
        switch status {
        case 0: return "errors.network"
        case 401: return "errors.unauthorized"
        case 403: return "errors.forbidden"
        case 404: return "errors.notFound"
        case 409: return "errors.CONFLICT"
        case 422, 400: return "errors.validation"
        case 429: return "errors.rateLimited"
        default: return status >= 500 ? "errors.server" : "common.unknownError"
        }
    }
}
