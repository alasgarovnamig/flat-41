import SwiftUI
import EvTapCore

/// Search: query pill + filters, deal / sort chips, infinite list or map, save search.
struct SearchView: View {
    @State private var vm = SearchViewModel()
    @State private var showFilters = false
    @State private var showSort = false
    @State private var showSave = false
    @Environment(Router.self) private var router

    var body: some View {
        VStack(spacing: 0) {
            topBar
            Group {
                if vm.mapMode {
                    SearchMapView(vm: vm)
                } else {
                    resultsList
                }
            }
            .frame(maxHeight: .infinity)
        }
        .appBackground()
        .toolbar(.hidden, for: .navigationBar)
        .task {
            if vm.handle(router.searchRequest) { showFilters = true }
            await vm.loadIfNeeded()
        }
        .onChange(of: router.searchRequest) { _, request in
            if vm.handle(request) { showFilters = true }
        }
        .sheet(isPresented: $showFilters) {
            FilterSheet(initial: vm.filters) { vm.apply($0) }
        }
        .sheet(isPresented: $showSave) {
            SaveSearchSheet(defaultName: vm.defaultSearchName) { name, notify in
                await vm.saveSearch(name: name, notify: notify)
            }
        }
        .confirmationDialog(L("search.sort"), isPresented: $showSort, titleVisibility: .visible) {
            ForEach(ListingSort.allCases) { sort in
                Button((vm.filters.sort == sort ? "✓ " : "") + L("sort.\(sort.rawValue)")) { vm.setSort(sort) }
            }
        }
    }

    private var topBar: some View {
        VStack(spacing: EvSpace.s3) {
            SearchField(text: $vm.queryText, placeholder: L("home.searchPlaceholder"), filterCount: vm.filters.activeCount,
                        onFilters: { showFilters = true })
            .padding(.horizontal, EvSize.gutter)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: EvSpace.s2) {
                    FilterPill(title: vm.mapMode ? L("search.list") : L("search.map"), icon: vm.mapMode ? "list.bullet" : "map",
                               isSelected: vm.mapMode, showsChevron: false) {
                        vm.mapMode.toggle()
                    }
                    ForEach(DealType.allCases) { deal in
                        SelectChip(title: LE("dealTypeShort", deal.rawValue), isSelected: vm.filters.dealType == deal) {
                            vm.setDeal(deal)
                        }
                    }
                    FilterPill(title: L("sort.\(vm.filters.sort.rawValue)"), icon: "arrow.up.arrow.down") { showSort = true }
                }
                .padding(.horizontal, EvSize.gutter)
            }
        }
        .padding(.top, EvSpace.s2)
        .padding(.bottom, EvSpace.s2)
    }

    private var resultsList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: EvSpace.s4) {
                if let total = vm.list.total {
                    HStack {
                        Text(L("search.results", ["n": Format.grouped(total)]))
                            .font(.ev(EvType.label))
                            .foregroundStyle(EvColor.inkSecondary)
                        Spacer()
                        Button {
                            router.requireAuth { showSave = true }
                        } label: {
                            Label(L("search.saveSearch"), systemImage: "bookmark")
                                .font(.ev(EvType.label))
                                .foregroundStyle(EvColor.ink)
                                .frame(minHeight: EvSize.touch)
                        }
                        .buttonStyle(.plain)
                    }
                }
                if vm.list.isInitialLoading {
                    ForEach(0..<3, id: \.self) { _ in PropertyCardSkeleton() }
                } else if let error = vm.list.error, vm.list.isEmpty {
                    ErrorStateView(error: error) { Task { await vm.reload() } }
                } else if vm.list.isEmpty && !vm.list.isLoading {
                    EmptyState(icon: "magnifyingglass", title: L("search.noResults"), message: L("search.noResultsHint"),
                               actionTitle: L("common.reset")) { vm.resetFilters() }
                } else {
                    ForEach(vm.list.items) { card in
                        PropertyCard(card: card)
                            .onAppear { Task { await vm.list.loadMoreIfNeeded(card) } }
                    }
                    if vm.list.isLoadingMore {
                        ProgressView().tint(EvColor.ink).frame(maxWidth: .infinity).padding()
                    }
                }
            }
            .padding(.horizontal, EvSize.gutter)
            .padding(.bottom, EvSpace.s8)
        }
        .scrollDismissesKeyboard(.immediately)
        .refreshable { await vm.reload() }
    }
}

/// Name + notify toggle → POST /saved-searches.
struct SaveSearchSheet: View {
    let defaultName: String
    let onSave: (String, Bool) async -> Bool

    @State private var name = ""
    @State private var notify = true
    @State private var saving = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        EvSheet(title: L("search.saveSearch")) {
            EvTextField(label: L("search.saveSearchName"), text: $name, maxLength: 80)
            ToggleRow(title: L("search.saveSearchNotify"), isOn: $notify)
        } footer: {
            PrimaryButton(title: L("common.save"), isLoading: saving) {
                Task {
                    saving = true
                    let ok = await onSave(name.trimmingCharacters(in: .whitespaces), notify)
                    saving = false
                    if ok { dismiss() }
                }
            }
            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .presentationDetents([.medium])
        .onAppear { if name.isEmpty { name = defaultName } }
    }
}
