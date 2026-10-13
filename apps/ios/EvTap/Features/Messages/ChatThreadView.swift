import SwiftUI
import EvTapCore

@MainActor
@Observable
final class ChatViewModel {
    static let pageSize = 50

    let conversationId: String
    private(set) var conversation: Conversation?
    /// Oldest first.
    private(set) var messages: [Message] = []
    private(set) var loading = false
    private(set) var loadingOlder = false
    private(set) var hasOlder = true
    private(set) var otherTyping = false
    private(set) var error: Error?
    var draft = "" { didSet { if draft.count > oldValue.count { typed() } } }

    @ObservationIgnored private var subscription: UUID?
    @ObservationIgnored private var typingReset: Task<Void, Never>?
    @ObservationIgnored private var tempCounter = 0

    init(conversationId: String) { self.conversationId = conversationId }

    var meId: String? { AppServices.shared.session.me?.id }
    /// Last own message the other side has read (✓✓).
    var lastReadMineId: String? { messages.last { $0.senderId == meId && $0.readAt != nil }?.id }

    func start() async {
        let services = AppServices.shared
        if subscription == nil {
            subscription = services.realtime.subscribe { [weak self] event in self?.handle(event) }
        }
        loading = messages.isEmpty
        defer { loading = false }
        do {
            let api = services.api
            let id = conversationId
            async let conv = Self.fetchConversation(api, id)
            let page = try await api.send(API.messages(id, limit: Self.pageSize))
            messages = page
            hasOlder = page.count >= Self.pageSize
            conversation = await conv
            error = nil
            markRead()
        } catch {
            self.error = error
        }
    }

    func stop() {
        if let subscription { AppServices.shared.realtime.unsubscribe(subscription) }
        subscription = nil
        typingReset?.cancel()
    }

    private nonisolated static func fetchConversation(_ api: APIClient, _ id: String) async -> Conversation? {
        try? await api.send(API.conversation(id))
    }

    func loadOlder() async {
        guard hasOlder, !loadingOlder, let oldest = messages.first(where: { !$0.id.hasPrefix("temp-") }) else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let older = try await AppServices.shared.api.send(API.messages(conversationId, before: oldest.id, limit: Self.pageSize))
            let known = Set(messages.map(\.id))
            messages = older.filter { !known.contains($0.id) } + messages
            hasOlder = older.count >= Self.pageSize
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    /// Optimistic send: temp bubble → replaced by the server message (or removed + text restored on failure).
    func send() async {
        guard let body = Validation.messageBody(draft) else { return }
        tempCounter += 1
        let tempId = "temp-\(tempCounter)"
        messages.append(Message(id: tempId, conversationId: conversationId, senderId: meId ?? "", body: body, createdAt: Date(), readAt: nil))
        draft = ""
        do {
            let m = try await AppServices.shared.api.send(API.sendMessage(conversationId, body: body))
            messages.removeAll { $0.id == tempId }
            if !messages.contains(where: { $0.id == m.id }) { messages.append(m) }
            AppServices.shared.bus.bump(.conversations)
        } catch {
            messages.removeAll { $0.id == tempId }
            draft = body
            AppServices.shared.toast.error(error)
        }
    }

    private func typed() {
        AppServices.shared.realtime.sendTyping(conversationId: conversationId)
    }

    private func markRead() {
        let id = conversationId
        Task {
            _ = try? await AppServices.shared.api.send(API.markRead(id))
            await AppServices.shared.realtime.refreshUnread()
        }
    }

    private func handle(_ event: RealtimeEvent) {
        switch event {
        case .messageNew(let m) where m.conversationId == conversationId:
            if !messages.contains(where: { $0.id == m.id }) { messages.append(m) }
            if m.senderId != meId {
                otherTyping = false
                markRead()
            }
        case .conversationRead(let e) where e.conversationId == conversationId:
            for i in messages.indices where messages[i].senderId != e.readerId && messages[i].readAt == nil && messages[i].createdAt <= e.readAt {
                messages[i].readAt = e.readAt
            }
        case .typing(let e) where e.conversationId == conversationId && e.userId != meId:
            otherTyping = true
            typingReset?.cancel()
            typingReset = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                guard !Task.isCancelled else { return }
                self?.otherTyping = false
            }
        case .connected:
            // Catch up on anything missed while offline.
            Task { await refreshLatest() }
        default:
            break
        }
    }

    private func refreshLatest() async {
        guard let latest = try? await AppServices.shared.api.send(API.messages(conversationId, limit: Self.pageSize)) else { return }
        let known = Set(messages.map(\.id))
        let fresh = latest.filter { !known.contains($0.id) }
        if !fresh.isEmpty {
            messages = (messages + fresh).sorted { $0.createdAt < $1.createdAt }
            markRead()
        }
    }
}

/// Realtime chat thread: bubbles (mine = ink), read ticks, typing indicator, load older, optimistic send.
struct ChatThreadView: View {
    @State private var vm: ChatViewModel
    @FocusState private var inputFocused: Bool
    @Environment(Router.self) private var router

    init(conversationId: String) {
        _vm = State(initialValue: ChatViewModel(conversationId: conversationId))
    }

    var body: some View {
        RequireAuth {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        if vm.hasOlder && !vm.messages.isEmpty {
                            Button {
                                Task { await vm.loadOlder() }
                            } label: {
                                Group {
                                    if vm.loadingOlder { ProgressView().tint(EvColor.ink) } else { Text(L("chat.loadOlder")).font(.ev(EvType.label)) }
                                }
                                .foregroundStyle(EvColor.inkSecondary)
                                .frame(minHeight: EvSize.touch)
                            }
                            .buttonStyle(.plain)
                        }
                        if vm.loading {
                            ProgressView().tint(EvColor.ink).padding(.top, EvSpace.s8)
                        } else if let e = vm.error, vm.messages.isEmpty {
                            ErrorStateView(error: e) { Task { await vm.start() } }
                        } else if vm.messages.isEmpty {
                            Text(L("chat.empty")).font(.ev(EvType.body)).foregroundStyle(EvColor.muted).padding(.top, EvSpace.s10)
                        }
                        ForEach(vm.messages) { m in
                            bubble(m).id(m.id)
                        }
                        if vm.otherTyping {
                            TypingBubble().frame(maxWidth: .infinity, alignment: .leading).id("typing")
                        }
                    }
                    .padding(.horizontal, EvSize.gutter)
                    .padding(.vertical, EvSpace.s3)
                }
                .defaultScrollAnchor(.bottom)
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: vm.messages.last?.id) { _, id in
                    guard let id else { return }
                    withAnimation(.easeOut(duration: EvMotion.fast)) { proxy.scrollTo(id, anchor: .bottom) }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { inputBar }
        }
        .appBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Button {
                    if let id = vm.conversation?.listing.id { router.push(.listing(id: id)) }
                } label: {
                    VStack(spacing: 0) {
                        Text(vm.conversation?.otherUser.name ?? "").font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink).lineLimit(1)
                        Text(vm.otherTyping ? L("chat.typing") : (vm.conversation?.listing.title ?? ""))
                            .font(.ev(EvType.caption))
                            .foregroundStyle(vm.otherTyping ? EvColor.success : EvColor.muted)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: 240)
                }
                .buttonStyle(.plain)
                .accessibilityHint(L("myListings.view"))
            }
        }
        .task { await vm.start() }
        .onDisappear { vm.stop() }
    }

    private func bubble(_ m: Message) -> some View {
        let mine = m.senderId == vm.meId
        let pending = m.id.hasPrefix("temp-")
        return HStack {
            if mine { Spacer(minLength: 48) }
            VStack(alignment: .trailing, spacing: 2) {
                Text(m.body)
                    .font(.ev(EvType.body))
                    .foregroundStyle(mine ? EvColor.onInk : EvColor.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                HStack(spacing: 4) {
                    Text(DateText.time(m.createdAt)).font(.ev(EvType.caption, size: 11))
                    if mine {
                        Image(systemName: pending ? "clock" : (m.readAt != nil ? "checkmark.circle.fill" : "checkmark"))
                            .font(.system(size: 10, weight: .semibold))
                            .accessibilityLabel(pending ? L("chat.sending") : (m.readAt != nil ? L("chat.read") : L("chat.sent")))
                    }
                }
                .foregroundStyle(mine ? EvColor.onInk.opacity(0.7) : EvColor.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(
                UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: mine ? 20 : 6, bottomTrailingRadius: mine ? 6 : 20, topTrailingRadius: 20, style: .continuous)
                    .fill(mine ? EvColor.ink : EvColor.surfaceRaised)
            )
            .fixedSize(horizontal: false, vertical: true)
            .opacity(pending ? 0.7 : 1)
            if !mine { Spacer(minLength: 48) }
        }
        .accessibilityElement(children: .combine)
    }

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: EvSpace.s2) {
            TextField(L("chat.placeholder"), text: $vm.draft, axis: .vertical)
                .lineLimit(1...5)
                .font(.ev(EvType.body))
                .focused($inputFocused)
                .padding(.horizontal, EvSpace.s4)
                .padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(EvColor.surfaceRaised))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(EvColor.hairline))
                .accessibilityLabel(L("chat.placeholder"))
            IconButton(systemName: "arrow.up", label: L("common.send"), style: .ink) { Task { await vm.send() } }
                .disabled(Validation.messageBody(vm.draft) == nil)
                .opacity(Validation.messageBody(vm.draft) == nil ? 0.4 : 1)
        }
        .padding(.horizontal, EvSize.gutter)
        .padding(.vertical, EvSpace.s2)
        .evGlass(in: Rectangle())
    }
}

/// Three pulsing dots (static with Reduce Motion).
private struct TypingBubble: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(EvColor.muted)
                    .frame(width: 7, height: 7)
                    .opacity(reduceMotion ? 0.7 : (phase ? 1 : 0.3))
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.6).repeatForever().delay(Double(i) * 0.2), value: phase)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Capsule().fill(EvColor.surfaceRaised))
        .onAppear { phase = true }
        .accessibilityLabel(L("chat.typing"))
    }
}
