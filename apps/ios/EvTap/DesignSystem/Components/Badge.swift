import SwiftUI
import EvTapCore

enum EvTone {
    case success, warning, danger, info, neutral

    var foreground: Color {
        switch self {
        case .success: return EvColor.success
        case .warning: return EvColor.warning
        case .danger: return EvColor.danger
        case .info: return EvColor.info
        case .neutral: return EvColor.inkSecondary
        }
    }

    var background: Color {
        switch self {
        case .success: return EvColor.successBg
        case .warning: return EvColor.warningBg
        case .danger: return EvColor.dangerBg
        case .info: return EvColor.infoBg
        case .neutral: return EvColor.pill
        }
    }
}

/// Listing / status badges (never colour alone: every badge has text, VIP has a star).
struct Badge: View {
    enum Kind {
        case vip, premium, urgent, verified, business, owner
        case tone(EvTone)
    }

    let text: String
    var kind: Kind = .tone(.neutral)
    var large = false

    var body: some View {
        HStack(spacing: 4) {
            switch kind {
            case .vip: Image(systemName: "star.fill").font(.system(size: 9, weight: .semibold))
            case .urgent: Circle().fill(EvColor.danger).frame(width: 6, height: 6)
            case .verified: Image(systemName: "checkmark").font(.system(size: 9, weight: .bold))
            case .tone: Circle().fill(foreground).frame(width: 6, height: 6)
            default: EmptyView()
            }
            Text(text)
                .font(.ev(EvType.caption, weight: .medium, size: large ? 13 : 11))
                .lineLimit(1)
                .fixedSize()
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, large ? 10 : 8)
        .padding(.vertical, large ? 5 : 3)
        .background(Capsule(style: .continuous).fill(background))
        .accessibilityElement(children: .combine)
    }

    private var foreground: Color {
        switch kind {
        case .vip: return EvColor.vip
        case .premium: return EvColor.onInk
        case .urgent: return EvColor.danger
        case .verified: return EvColor.success
        case .business, .owner: return EvColor.ink
        case .tone(let t): return t.foreground
        }
    }

    private var background: Color {
        switch kind {
        case .vip: return EvColor.vipBg
        case .premium: return EvColor.premium
        case .urgent: return EvColor.dangerBg
        case .verified: return EvColor.successBg
        case .business, .owner: return EvColor.pill
        case .tone(let t): return t.background
        }
    }
}

/// Status pill (Active / Pending / Rejected …) with a coloured dot + text.
struct StatusPill: View {
    let text: String
    let tone: EvTone
    var body: some View { Badge(text: text, kind: .tone(tone)) }
}

/// Premium · VIP · Təcili · Yoxlanılıb row for a listing.
struct ListingBadges: View {
    let card: ListingCard
    var large = false

    var body: some View {
        HStack(spacing: 4) {
            if card.isPremium { Badge(text: L("badge.premium"), kind: .premium, large: large) }
            if card.isVip { Badge(text: L("badge.vip"), kind: .vip, large: large) }
            if card.isUrgent { Badge(text: L("badge.urgent"), kind: .urgent, large: large) }
            if card.isVerified { Badge(text: L("badge.verified"), kind: .verified, large: large) }
        }
    }
}

extension ListingStatus {
    var tone: EvTone {
        switch self {
        case .ACTIVE: return .success
        case .PENDING, .DRAFT: return .warning
        case .REJECTED, .BLOCKED: return .danger
        case .SOLD: return .info
        case .EXPIRED, .ARCHIVED: return .neutral
        }
    }
}

extension BookingStatus {
    var tone: EvTone {
        switch self {
        case .CONFIRMED: return .success
        case .PENDING_PAYMENT: return .warning
        case .CANCELLED: return .danger
        case .COMPLETED: return .info
        case .REFUNDED: return .neutral
        }
    }
}

extension PaymentStatus {
    var tone: EvTone {
        switch self {
        case .SUCCEEDED: return .success
        case .PENDING, .CREATED: return .warning
        case .FAILED: return .danger
        case .REFUNDED, .PARTIALLY_REFUNDED: return .info
        case .CANCELLED: return .neutral
        }
    }
}

extension DealType {
    /// Dot colour of the "• For Rent" meta row.
    var dotColor: Color {
        switch self {
        case .SALE: return EvColor.info
        case .RENT_LONG: return EvColor.accentStrong
        case .RENT_DAILY: return EvColor.success
        }
    }

    var icon: String {
        switch self {
        case .SALE: return "tag"
        case .RENT_LONG: return "key"
        case .RENT_DAILY: return "calendar"
        }
    }
}
