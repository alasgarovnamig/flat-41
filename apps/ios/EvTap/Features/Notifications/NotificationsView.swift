import SwiftUI
import EvTapCore

/// In-app notifications (paged) with read / read-all; tapping routes through the payload's deep link.
struct NotificationsView: View {
    @State private var list = PagedList<AppNotification> { page in try await AppServices.shared.api.send(API.notifications(page: page)) }
    @State private var readIds: Set<String> = []
    @Environment(Router.self) private var router
    @Environment(RefreshBus.self) private var bus

    var body: some View {
        RequireAuth {
            ScrollView {
                LazyVStack(spacing: 0) {
                    if list.isInitialLoading {
                        ListSkeleton(rows: 6)
                    } else if let e = list.error, list.isEmpty {
                        ErrorStateView(error: e) { Task { await list.refresh() } }
                    } else if list.isEmpty {
                        EmptyState(icon: "bell.slash", title: L("notifications.empty"))
                    } else {
                        RowGroup {
                            ForEach(list.items) { n in
                                Button {
                                    open(n)
                                } label: {
                                    row(n)
                                }
                                .buttonStyle(RowPressStyle())
                                .onAppear { Task { await list.loadMoreIfNeeded(n) } }
                                if n.id != list.items.last?.id { RowDivider() }
                            }
                        }
                    }
                }
                .padding(EvSize.gutter)
            }
            .refreshable { await list.refresh() }
        }
        .evScreen(L("notifications.title"))
        .toolbar {
            if list.items.contains(where: { $0.readAt == nil && !readIds.contains($0.id) }) {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L("notifications.readAll")) { Task { await readAll() } }
                        .font(.ev(EvType.label))
                        .foregroundStyle(EvColor.ink)
                }
            }
        }
        .task(id: bus.version(.notifications)) { await list.refresh() }
    }

    private func isUnread(_ n: AppNotification) -> Bool { n.readAt == nil && !readIds.contains(n.id) }

    private func row(_ n: AppNotification) -> some View {
        HStack(alignment: .top, spacing: EvSpace.s3) {
            Image(systemName: n.kind?.icon ?? "bell")
                .font(.system(size: 16))
                .foregroundStyle(EvColor.ink)
                .frame(width: 40, height: 40)
                .background(Circle().fill(isUnread(n) ? EvColor.accent : EvColor.surfaceSunken))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(n.title).font(.ev(EvType.bodyStrong, weight: isUnread(n) ? .semibold : .medium)).foregroundStyle(EvColor.ink)
                Text(n.body).font(.ev(EvType.label, weight: .regular)).foregroundStyle(EvColor.inkSecondary)
                Text(DateText.relative(n.createdAt)).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
            }
            Spacer(minLength: 0)
            if isUnread(n) {
                Circle().fill(EvColor.ink).frame(width: 8, height: 8).padding(.top, 6)
                    .accessibilityLabel(L("notifications.unread"))
            }
        }
        .padding(EvSpace.s4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func open(_ n: AppNotification) {
        if isUnread(n) {
            readIds.insert(n.id)
            let id = n.id
            Task {
                _ = try? await AppServices.shared.api.send(API.readNotification(id))
                await AppServices.shared.session.refreshMe()
            }
        }
        if let link = DeepLink.from(notificationData: n.data) { router.open(link) }
    }

    private func readAll() async {
        readIds.formUnion(list.items.map(\.id))
        _ = try? await AppServices.shared.api.send(API.readAllNotifications())
        await AppServices.shared.session.refreshMe()
    }
}

extension NotificationType {
    var icon: String {
        switch self {
        case .LISTING_APPROVED: return "checkmark.circle"
        case .LISTING_REJECTED: return "xmark.circle"
        case .LISTING_EXPIRING, .LISTING_EXPIRED: return "clock"
        case .NEW_MESSAGE: return "bubble.left"
        case .PAYMENT_SUCCEEDED: return "creditcard"
        case .PAYMENT_FAILED: return "exclamationmark.circle"
        case .BOOKING_NEW, .BOOKING_CONFIRMED: return "calendar"
        case .BOOKING_CANCELLED: return "calendar.badge.minus"
        case .PAYOUT: return "banknote"
        case .SAVED_SEARCH_MATCH: return "magnifyingglass"
        case .PROMOTION_EXPIRED: return "arrow.up.circle"
        case .SUBSCRIPTION_RENEWED, .SUBSCRIPTION_EXPIRED: return "briefcase"
        case .SYSTEM: return "megaphone"
        }
    }
}
