import SwiftUI
import EvTapCore

/// `GET /payments` — every charge with status; tap opens the result screen (re-polls the status).
struct PaymentsHistoryView: View {
    @State private var list = PagedList<Payment> { page in try await AppServices.shared.api.send(API.payments(page: page)) }
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
                        EmptyState(icon: "doc.text", title: L("payments.empty"))
                    } else {
                        RowGroup {
                            ForEach(list.items) { p in
                                Button {
                                    router.push(.paymentResult(paymentId: p.id, status: p.status.rawValue, context: PaymentContext(listingId: p.listingId, bookingId: p.bookingId)))
                                } label: {
                                    row(p)
                                }
                                .buttonStyle(RowPressStyle())
                                .onAppear { Task { await list.loadMoreIfNeeded(p) } }
                                if p.id != list.items.last?.id { RowDivider() }
                            }
                        }
                    }
                }
                .padding(EvSize.gutter)
            }
            .refreshable { await list.refresh() }
        }
        .evScreen(L("payments.title"))
        .task(id: bus.version(.payments)) { await list.refresh() }
    }

    private func row(_ p: Payment) -> some View {
        HStack(spacing: EvSpace.s3) {
            Image(systemName: p.method == .CARD ? "creditcard" : "wallet.pass")
                .font(.system(size: 16))
                .foregroundStyle(EvColor.ink)
                .frame(width: 40, height: 40)
                .background(Circle().fill(EvColor.surfaceSunken))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(LE("paymentPurpose", p.purpose.rawValue)).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                if !p.description.isEmpty {
                    Text(p.description).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted).lineLimit(1)
                }
                Text("\(DateText.dateTime(p.createdAt)) · \(LE("paymentMethod", p.method.rawValue))\(p.cardMask.map { " \($0)" } ?? "")")
                    .font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
            }
            Spacer(minLength: EvSpace.s2)
            VStack(alignment: .trailing, spacing: 4) {
                Text(Format.money(p.amount, p.currency)).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                StatusPill(text: LE("paymentStatus", p.status.rawValue), tone: p.status.tone)
            }
        }
        .padding(.horizontal, EvSpace.s4)
        .padding(.vertical, EvSpace.s3)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
