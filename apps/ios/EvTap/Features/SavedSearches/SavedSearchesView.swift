import SwiftUI
import EvTapCore

@MainActor
@Observable
final class SavedSearchesViewModel {
    private(set) var state: Loadable<[SavedSearch]> = .idle

    var items: [SavedSearch] { state.value ?? [] }

    func load() async {
        if state.value == nil { state = .loading }
        do { state = .loaded(try await AppServices.shared.api.send(API.savedSearches())) } catch {
            if state.value == nil { state = .failed(error) }
        }
    }

    func delete(_ s: SavedSearch) async {
        let before = items
        state = .loaded(before.filter { $0.id != s.id })
        do {
            _ = try await AppServices.shared.api.send(API.deleteSavedSearch(s.id))
        } catch {
            state = .loaded(before)
            AppServices.shared.toast.error(error)
        }
    }

    /// `PATCH /saved-searches/:id { notify }`.
    func setNotify(_ s: SavedSearch, _ notify: Bool) async {
        do {
            let updated = try await AppServices.shared.api.send(API.updateSavedSearch(s.id, SavedSearchPatch(notify: notify)))
            state = .loaded(items.map { $0.id == updated.id ? updated : $0 })
        } catch {
            AppServices.shared.toast.error(error)
        }
    }
}

struct SavedSearchesView: View {
    @State private var vm = SavedSearchesViewModel()
    @State private var pendingDelete: SavedSearch? = nil
    @Environment(Router.self) private var router
    @Environment(RefreshBus.self) private var bus

    var body: some View {
        RequireAuth {
            Group {
                switch vm.state {
                case .failed(let e):
                    ErrorStateView(error: e) { Task { await vm.load() } }
                case .loaded(let items) where items.isEmpty:
                    EmptyState(icon: "bookmark", title: L("saved.empty"), message: L("saved.emptyHint"), actionTitle: L("common.search")) {
                        router.openSearch()
                    }
                case .loaded(let items):
                    ScrollView {
                        LazyVStack(spacing: EvSpace.s3) {
                            ForEach(items) { s in row(s) }
                        }
                        .padding(EvSize.gutter)
                    }
                    .refreshable { await vm.load() }
                default:
                    ListSkeleton(rows: 4, rowHeight: 80)
                }
            }
        }
        .evScreen(L("saved.title"))
        .task(id: bus.version(.savedSearches)) { await vm.load() }
        .alert(L("saved.confirmDelete"), isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), presenting: pendingDelete) { s in
            Button(L("common.cancel"), role: .cancel) {}
            Button(L("common.delete"), role: .destructive) { Task { await vm.delete(s) } }
        } message: { s in
            Text(s.name)
        }
    }

    private func row(_ s: SavedSearch) -> some View {
        let filters = ListingFilters(savedQuery: s.query)
        let locations = AppServices.shared.locations
        let summary = [
            filters.dealType.map { LE("dealType", $0.rawValue) },
            locations.city(filters.cityId)?.name.current,
            filters.priceMax.map { "≤ \(Format.price($0, filters.currency ?? .AZN))" },
        ].compactMap { $0 }.joined(separator: " · ")
        return VStack(alignment: .leading, spacing: EvSpace.s3) {
            Button {
                router.openSearch(filters)
            } label: {
                HStack(alignment: .top, spacing: EvSpace.s3) {
                    Image(systemName: "magnifyingglass")
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(EvColor.surfaceSunken))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(s.name).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink).lineLimit(1)
                            if s.newMatches > 0 { Badge(text: L("saved.newMatches", ["n": s.newMatches]), kind: .tone(.success)) }
                        }
                        if !summary.isEmpty { Text(summary).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted).lineLimit(1) }
                        Text(DateText.day(s.createdAt)).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right").foregroundStyle(EvColor.inkSecondary).accessibilityHidden(true)
                }
                .foregroundStyle(EvColor.ink)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            HStack {
                ToggleRow(title: L("saved.notifyOn"), isOn: Binding(get: { s.notify }, set: { v in Task { await vm.setNotify(s, v) } }))
                IconButton(systemName: "trash", label: L("common.delete"), style: .sunken, tint: EvColor.danger) { pendingDelete = s }
            }
        }
        .evCard(padding: EvSpace.s4, radius: EvRadius.lg)
    }
}
