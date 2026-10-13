import SwiftUI
import EvTapCore

/// Conversations list (tab). Realtime `message:new` / `conversation:read` bump the list.
struct ConversationsView: View {
    @State private var list = PagedList<Conversation> { page in try await AppServices.shared.api.send(API.conversations(page: page)) }
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(RefreshBus.self) private var bus

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(L("messages.title"))
                .evText(EvType.h1)
                .foregroundStyle(EvColor.ink)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, EvSize.gutter)
                .padding(.vertical, EvSpace.s2)
            if !session.isSignedIn {
                EmptyState(icon: "bubble.left.and.bubble.right", title: L("messages.empty"), message: L("profile.guestText"),
                           actionTitle: L("common.login")) { router.requireAuth() }
                    .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        if list.isInitialLoading {
                            ListSkeleton(rows: 6, rowHeight: 72)
                        } else if let e = list.error, list.isEmpty {
                            ErrorStateView(error: e) { Task { await list.refresh() } }
                        } else if list.isEmpty {
                            EmptyState(icon: "bubble.left.and.bubble.right", title: L("messages.empty"), message: L("messages.emptyHint"))
                        } else {
                            RowGroup {
                                ForEach(list.items) { c in
                                    Button {
                                        router.push(.chat(conversationId: c.id))
                                    } label: {
                                        ConversationRow(conversation: c, meId: session.me?.id)
                                    }
                                    .buttonStyle(RowPressStyle())
                                    .onAppear { Task { await list.loadMoreIfNeeded(c) } }
                                    if c.id != list.items.last?.id { RowDivider() }
                                }
                            }
                            .padding(.horizontal, EvSize.gutter)
                        }
                    }
                    .padding(.bottom, EvSpace.s8)
                }
                .refreshable { await list.refresh() }
            }
        }
        .appBackground()
        .toolbar(.hidden, for: .navigationBar)
        .task(id: "\(session.isSignedIn)-\(bus.version(.conversations))") {
            if session.isSignedIn { await list.refresh() }
        }
    }
}

private struct ConversationRow: View {
    let conversation: Conversation
    let meId: String?

    var body: some View {
        let c = conversation
        let unread = c.unreadCount > 0
        let mine = c.lastMessage?.senderId == meId
        return HStack(spacing: EvSpace.s3) {
            ZStack(alignment: .bottomTrailing) {
                RemoteImage(url: AppServices.shared.api.mediaURL(c.listing.coverUrl), placeholderIcon: "house")
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous))
                Avatar(url: AppServices.shared.api.mediaURL(c.otherUser.avatarUrl), name: c.otherUser.name, size: 26)
                    .overlay(Circle().stroke(EvColor.surface, lineWidth: 2))
                    .offset(x: 6, y: 6)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(c.otherUser.name)
                        .font(.ev(EvType.bodyStrong, weight: unread ? .semibold : .medium))
                        .foregroundStyle(EvColor.ink)
                        .lineLimit(1)
                    Spacer()
                    Text(DateText.relative(c.lastMessage?.createdAt ?? c.updatedAt))
                        .font(.ev(EvType.caption))
                        .foregroundStyle(EvColor.muted)
                }
                Text("\(c.listing.title) · \(Format.price(c.listing.price, c.listing.currency))")
                    .font(.ev(EvType.caption))
                    .foregroundStyle(EvColor.muted)
                    .lineLimit(1)
                HStack {
                    Text((mine ? L("messages.you") : "") + (c.lastMessage?.body ?? ""))
                        .font(.ev(EvType.label, weight: unread ? .semibold : .regular))
                        .foregroundStyle(unread ? EvColor.ink : EvColor.inkSecondary)
                        .lineLimit(1)
                    Spacer()
                    if unread {
                        Text("\(c.unreadCount)")
                            .font(.ev(EvType.caption, weight: .semibold))
                            .foregroundStyle(EvColor.onInk)
                            .padding(.horizontal, 7)
                            .frame(minHeight: 20)
                            .background(Capsule().fill(EvColor.ink))
                    }
                }
            }
        }
        .padding(.horizontal, EvSpace.s4)
        .padding(.vertical, EvSpace.s3)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// First message to a listing owner → POST /conversations (the API reuses an existing thread).
struct NewConversationView: View {
    let listingId: String
    let listingTitle: String
    let ownerName: String

    @State private var text = ""
    @State private var sending = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        EvSheet(title: L("chat.newTitle")) {
            VStack(alignment: .leading, spacing: 4) {
                Text(ownerName).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                Text(listingTitle).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted).lineLimit(2)
            }
            .evCard(padding: EvSpace.s4, radius: EvRadius.lg)
            EvTextField(label: "", text: $text, placeholder: L("chat.placeholder"), multiline: true, maxLength: 2000)
        } footer: {
            PrimaryButton(title: L("common.send"), icon: "paperplane", isLoading: sending) { Task { await send() } }
                .disabled(Validation.messageBody(text) == nil)
        }
        .presentationDetents([.medium, .large])
        .onAppear { if text.isEmpty { text = L("chat.firstMessage") } }
    }

    private func send() async {
        guard let body = Validation.messageBody(text) else { return }
        sending = true
        defer { sending = false }
        do {
            let conv = try await AppServices.shared.api.send(API.startConversation(listingId: listingId, message: body))
            AppServices.shared.bus.bump(.conversations)
            dismiss()
            let router = AppServices.shared.router
            router.tab = .messages
            router.setPath([.chat(conversationId: conv.id)], for: .messages)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }
}
