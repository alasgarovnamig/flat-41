import SwiftUI
import EvTapCore

@MainActor
@Observable
final class HostCalendarViewModel {
    static let months = 6
    let listingId: String
    let today = ISODay.today()
    private(set) var state: Loadable<Availability> = .idle
    private(set) var blocked: Set<String> = []
    private(set) var booked: Set<String> = []
    private(set) var dirty = false
    private(set) var saving = false

    init(listingId: String) { self.listingId = listingId }

    func load() async {
        state = .loading
        do {
            let a = try await AppServices.shared.api.send(API.availability(listingId, from: today, to: ISODay.adding(Self.months * 31, to: today)))
            state = .loaded(a)
            blocked = Set(a.blockedDates)
            booked = a.bookedNights
            dirty = false
        } catch {
            state = .failed(error)
        }
    }

    func dayState(_ iso: String) -> CalendarDayState {
        if iso < today { return .past }
        if booked.contains(iso) { return .booked }
        return blocked.contains(iso) ? .blocked : .normal
    }

    func toggle(_ iso: String) {
        guard !booked.contains(iso), iso >= today else { return }
        if blocked.contains(iso) { blocked.remove(iso) } else { blocked.insert(iso) }
        dirty = true
    }

    func save() async {
        saving = true
        defer { saving = false }
        do {
            let a = try await AppServices.shared.api.send(API.setAvailability(listingId, blockedDates: blocked.filter { $0 >= today }.sorted()))
            state = .loaded(a)
            blocked = Set(a.blockedDates)
            dirty = false
            AppServices.shared.toast.show(L("common.saved"), kind: .success)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }
}

/// Host calendar: without a listing id → pick one of the user's daily-rent listings; with one → block / unblock days.
struct HostCalendarView: View {
    let listingId: String?
    @Environment(Router.self) private var router

    var body: some View {
        RequireAuth {
            if let listingId {
                HostCalendarEditor(listingId: listingId)
            } else {
                DailyListingPicker()
            }
        }
        .evScreen(L("calendar.title"))
    }
}

private struct DailyListingPicker: View {
    @State private var state: Loadable<[MyListing]> = .idle
    @Environment(Router.self) private var router

    var body: some View {
        Group {
            switch state {
            case .loaded(let items) where items.isEmpty:
                EmptyState(icon: "calendar", title: L("calendar.noDaily"), actionTitle: L("myListings.newListing")) { router.presentPost() }
            case .loaded(let items):
                ScrollView {
                    VStack(alignment: .leading, spacing: EvSpace.s3) {
                        Text(L("calendar.chooseListing")).font(.ev(EvType.body)).foregroundStyle(EvColor.muted)
                        ForEach(items) { l in
                            Button {
                                router.push(.hostCalendar(listingId: l.id))
                            } label: {
                                HStack(spacing: EvSpace.s3) {
                                    RemoteImage(url: AppServices.shared.api.mediaURL(l.coverUrl))
                                        .frame(width: 56, height: 56)
                                        .clipShape(RoundedRectangle(cornerRadius: EvRadius.sm, style: .continuous))
                                    Text(l.title).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink).lineLimit(2)
                                    Spacer()
                                    Image(systemName: "chevron.right").foregroundStyle(EvColor.subtle).accessibilityHidden(true)
                                }
                                .evCard(padding: EvSpace.s3, radius: EvRadius.lg)
                            }
                            .buttonStyle(EvPressStyle())
                        }
                    }
                    .padding(EvSize.gutter)
                }
            case .failed(let e):
                ErrorStateView(error: e) { Task { await load() } }
            default:
                LoadingView()
            }
        }
        .task { await load() }
    }

    private func load() async {
        state = .loading
        do {
            let page = try await AppServices.shared.api.send(API.myListings(status: .ACTIVE, page: 1, pageSize: 100))
            state = .loaded(page.items.filter { $0.dealType == .RENT_DAILY })
        } catch {
            state = .failed(error)
        }
    }
}

private struct HostCalendarEditor: View {
    @State private var vm: HostCalendarViewModel

    init(listingId: String) {
        _vm = State(initialValue: HostCalendarViewModel(listingId: listingId))
    }

    var body: some View {
        Group {
            switch vm.state {
            case .failed(let e):
                ErrorStateView(error: e) { Task { await vm.load() } }
            case .loaded:
                ScrollView {
                    VStack(alignment: .leading, spacing: EvSpace.s4) {
                        Text(L("calendar.hint")).font(.ev(EvType.body)).foregroundStyle(EvColor.muted)
                        CalendarLegend(items: [(EvColor.dangerBg, "calendar.blocked", false), (EvColor.surfaceSunken, "calendar.booked", true), (Color.clear, "calendar.free", false)])
                        Card {
                            MonthCalendar(from: vm.today, months: HostCalendarViewModel.months, state: vm.dayState, onTap: vm.toggle)
                        }
                    }
                    .padding(EvSize.gutter)
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    PrimaryButton(title: L("common.save"), isLoading: vm.saving) { Task { await vm.save() } }
                        .disabled(!vm.dirty)
                        .padding(.horizontal, EvSize.gutter)
                        .padding(.vertical, EvSpace.s3)
                        .evGlass(in: Rectangle())
                }
            default:
                LoadingView()
            }
        }
        .task { if vm.state.value == nil { await vm.load() } }
    }
}
