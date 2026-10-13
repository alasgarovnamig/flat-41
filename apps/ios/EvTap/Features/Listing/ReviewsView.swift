import SwiftUI
import EvTapCore

/// All reviews of a daily-rent listing (paged); the host can reply once.
struct ReviewsView: View {
    let listingId: String
    let isOwner: Bool
    @State private var list: PagedList<Review>

    init(listingId: String, isOwner: Bool) {
        self.listingId = listingId
        self.isOwner = isOwner
        _list = State(initialValue: PagedList { page in
            try await AppServices.shared.api.send(API.reviews(listingId, page: page, pageSize: 20))
        })
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: EvSpace.s3) {
                if list.isInitialLoading {
                    ListSkeleton(rows: 5)
                } else if let error = list.error, list.isEmpty {
                    ErrorStateView(error: error) { Task { await list.refresh() } }
                } else if list.isEmpty {
                    EmptyState(icon: "star", title: L("listing.noReviews"))
                } else {
                    ForEach(list.items) { r in
                        ReviewRow(review: r, canReply: isOwner) { Task { await list.refresh() } }
                            .evCard(padding: EvSpace.s4, radius: EvRadius.lg)
                            .onAppear { Task { await list.loadMoreIfNeeded(r) } }
                    }
                }
            }
            .padding(EvSize.gutter)
        }
        .refreshable { await list.refresh() }
        .evScreen(L("listing.reviews"))
        .task { if list.isEmpty { await list.refresh() } }
    }
}

/// One review; the listing owner gets an inline reply field (POST /reviews/:id/reply).
struct ReviewRow: View {
    let review: Review
    var canReply = false
    var onReplied: () -> Void = {}

    @State private var replying = false
    @State private var reply = ""
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: EvSpace.s2) {
            HStack(spacing: EvSpace.s2) {
                Avatar(url: AppServices.shared.api.mediaURL(review.author.avatarUrl), name: review.author.name, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(review.author.name).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                    Text(DateText.day(review.createdAt)).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                }
                Spacer()
                StarRating(value: Double(review.rating))
            }
            Text(review.comment).font(.ev(EvType.body)).foregroundStyle(EvColor.ink)
            if let hostReply = review.hostReply {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("listing.hostReply")).font(.ev(EvType.label)).foregroundStyle(EvColor.inkSecondary)
                    Text(hostReply).font(.ev(EvType.body, size: 14)).foregroundStyle(EvColor.ink)
                }
                .padding(EvSpace.s3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(EvColor.surfaceSunken))
                .padding(.leading, EvSpace.s6)
            } else if canReply {
                if replying {
                    VStack(alignment: .trailing, spacing: EvSpace.s2) {
                        EvTextField(label: "", text: $reply, placeholder: L("listing.reply"), multiline: true, maxLength: 2000)
                        PrimaryButton(title: L("common.send"), size: .small, fullWidth: false, isLoading: sending) { Task { await send() } }
                            .disabled(reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .padding(.leading, EvSpace.s6)
                } else {
                    Button {
                        replying = true
                    } label: {
                        Label(L("listing.reply"), systemImage: "arrowshape.turn.up.left")
                            .font(.ev(EvType.label))
                            .foregroundStyle(EvColor.ink)
                            .frame(minHeight: EvSize.touch)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func send() async {
        sending = true
        defer { sending = false }
        do {
            _ = try await AppServices.shared.api.send(API.replyReview(review.id, reply: reply.trimmingCharacters(in: .whitespacesAndNewlines)))
            AppServices.shared.toast.show(L("listing.replySent"), kind: .success)
            replying = false
            onReplied()
        } catch {
            AppServices.shared.toast.error(error)
        }
    }
}
