import SwiftUI
import EvTapCore

/// Profile tab: header, wallet StatCard, free-listing quota meter, account / money / info sections, logout.
struct ProfileView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @State private var confirmLogout = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s5) {
                Text(L("tabs.profile")).evText(EvType.h1).foregroundStyle(EvColor.ink).accessibilityAddTraits(.isHeader)
                if session.isSignedIn {
                    signedIn
                } else {
                    guest
                }
                infoSection
                Text("EvTap · \(L("profile.version", ["v": AppConfig.version]))")
                    .font(.ev(EvType.caption))
                    .foregroundStyle(EvColor.muted)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, EvSize.gutter)
            .padding(.vertical, EvSpace.s2)
            .padding(.bottom, EvSpace.s8)
        }
        .refreshable { await session.refreshMe() }
        .appBackground()
        .toolbar(.hidden, for: .navigationBar)
        .alert(L("common.logout"), isPresented: $confirmLogout) {
            Button(L("common.cancel"), role: .cancel) {}
            Button(L("common.logout"), role: .destructive) { Task { await session.logout() } }
        } message: {
            Text(L("settings.logoutConfirm"))
        }
    }

    private var guest: some View {
        VStack(spacing: EvSpace.s4) {
            EmptyState(icon: "person", title: L("profile.guestTitle"), message: L("profile.guestText"), actionTitle: L("common.login")) {
                router.requireAuth()
            }
            .background(CardSurface())
            RowGroup {
                ListRow(icon: "gearshape", title: L("profile.settings")) { router.push(.settings) }
            }
        }
    }

    @ViewBuilder private var signedIn: some View {
        let me = session.me
        Button {
            router.push(.editProfile)
        } label: {
            HStack(spacing: EvSpace.s3) {
                Avatar(url: AppServices.shared.api.mediaURL(me?.avatarUrl), name: me?.name ?? "", size: 64)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(me?.name ?? "…").evText(EvType.h2).foregroundStyle(EvColor.ink).lineLimit(1)
                        if me?.isBusiness == true { Badge(text: L("badge.business"), kind: .business) }
                    }
                    Text(me?.phone.map(Format.phone) ?? me?.email ?? "").font(.ev(EvType.label, weight: .regular)).foregroundStyle(EvColor.muted)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(EvColor.subtle).accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(EvPressStyle())

        StatCard(label: L("profile.balance"), money: Format.moneyParts(me?.wallet.balance ?? 0, me?.wallet.currency ?? .AZN),
                 caption: (me?.wallet.bonusBalance ?? 0) > 0 ? L("profile.bonus", ["amount": Format.money(me?.wallet.bonusBalance ?? 0)]) : L("wallet.title"),
                 openAction: { router.push(.wallet) }, openLabel: L("wallet.topup"))

        if let q = me?.quota, !q.isUnlimited {
            SplitMeter(left: .init(label: L("profile.quotaUsed"), value: "\(q.used)", amount: Double(q.used)),
                       right: .init(label: L("profile.quotaLeft"), value: "\(max(0, q.remaining))", amount: 0),
                       capacity: Double(max(q.freeLimit, q.used)))
                .evCard()
                .accessibilityLabel(L("profile.quota", ["left": max(0, q.remaining), "total": q.freeLimit]))
        }

        RowGroup {
            ListRow(icon: "square.stack", title: L("profile.myListings")) { router.push(.myListings) }
            RowDivider()
            ListRow(icon: "calendar", title: L("profile.bookings")) { router.push(.bookings) }
            RowDivider()
            ListRow(icon: "calendar.badge.clock", title: L("profile.hostCalendar")) { router.push(.hostCalendar(listingId: nil)) }
            RowDivider()
            ListRow(icon: "bell", title: L("profile.notifications"), badge: me?.unreadNotifications) { router.push(.notifications) }
            RowDivider()
            ListRow(icon: "bookmark", title: L("profile.savedSearches")) { router.push(.savedSearches) }
        }

        FieldLabel(text: L("profile.sectionMoney"))
        RowGroup {
            ListRow(icon: "wallet.pass", title: L("profile.wallet")) { router.push(.wallet) }
            RowDivider()
            ListRow(icon: "doc.text", title: L("profile.payments")) { router.push(.payments) }
            RowDivider()
            ListRow(icon: "briefcase", title: L("profile.business"),
                    subtitle: me?.subscription.map { "\($0.planCode.rawValue) · \($0.period == .YEAR ? L("business.yearly") : L("business.monthly"))" } ?? L("business.subtitle")) {
                router.push(.business)
            }
            RowDivider()
            ListRow(icon: "building.2", title: L("profile.agency")) { router.push(.agency) }
        }
    }

    private var infoSection: some View {
        VStack(alignment: .leading, spacing: EvSpace.s3) {
            FieldLabel(text: L("profile.sectionInfo"))
            RowGroup {
                if session.isSignedIn {
                    ListRow(icon: "gearshape", title: L("profile.settings")) { router.push(.settings) }
                    RowDivider()
                }
                ListRow(icon: "info.circle", title: L("profile.about")) { router.push(.page(slug: "about")) }
                RowDivider()
                ListRow(icon: "doc.plaintext", title: L("profile.terms")) { router.push(.page(slug: "terms")) }
                RowDivider()
                ListRow(icon: "lock.shield", title: L("profile.privacy")) { router.push(.page(slug: "privacy")) }
                RowDivider()
                ListRow(icon: "questionmark.circle", title: L("profile.help")) { router.push(.page(slug: "help")) }
                RowDivider()
                ListRow(icon: "books.vertical", title: L("pages.title")) { router.push(.pages) }
            }
            if session.isSignedIn {
                PrimaryButton(title: L("common.logout"), icon: "rectangle.portrait.and.arrow.right", kind: .secondary) { confirmLogout = true }
                    .padding(.top, EvSpace.s2)
            }
        }
    }
}
