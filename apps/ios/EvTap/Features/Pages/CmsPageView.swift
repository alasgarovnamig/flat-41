import SwiftUI
import EvTapCore

/// `GET /pages` — list of CMS pages (titles localised by `?locale=`).
struct PagesListView: View {
    @State private var state: Loadable<[CmsPageSummary]> = .idle
    @Environment(Router.self) private var router

    var body: some View {
        Group {
            switch state {
            case .loaded(let pages) where pages.isEmpty:
                EmptyState(icon: "doc", title: L("page.notFound"))
            case .loaded(let pages):
                ScrollView {
                    RowGroup {
                        ForEach(pages) { p in
                            ListRow(icon: "doc.text", title: p.title) { router.push(.page(slug: p.slug)) }
                            if p.id != pages.last?.id { RowDivider() }
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
        .evScreen(L("pages.title"))
        .task { await load() }
    }

    private func load() async {
        state = .loading
        do { state = .loaded(try await AppServices.shared.api.send(API.pages(locale: Localizer.shared.lang))) } catch { state = .failed(error) }
    }
}

/// `GET /pages/:slug` — Markdown body rendered as blocks; inline markup via `AttributedString(markdown:)`.
struct CmsPageView: View {
    let slug: String
    @State private var state: Loadable<CmsPage> = .idle

    var body: some View {
        Group {
            switch state {
            case .loaded(let page):
                content(page)
            case .failed(let e as APIError) where e.isNotFound:
                EmptyState(icon: "doc", title: L("page.notFound"))
            case .failed(let e):
                ErrorStateView(error: e) { Task { await load() } }
            default:
                LoadingView()
            }
        }
        .evScreen(state.value?.title.current ?? "")
        .task { await load() }
    }

    private func load() async {
        state = .loading
        do { state = .loaded(try await AppServices.shared.api.send(API.page(slug))) } catch { state = .failed(error) }
    }

    private func content(_ page: CmsPage) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s3) {
                Text(page.title.current).evText(EvType.h1).foregroundStyle(EvColor.ink).accessibilityAddTraits(.isHeader)
                Text(DateText.day(page.updatedAt)).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                ForEach(Array(MarkdownBlock.parse(page.body.current).enumerated()), id: \.offset) { _, block in
                    blockView(block)
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .padding(EvSize.gutter)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(inline(text))
                .evText(level <= 1 ? EvType.h2 : EvType.h3)
                .foregroundStyle(EvColor.ink)
                .padding(.top, EvSpace.s2)
                .accessibilityAddTraits(.isHeader)
        case .bullet(let text):
            HStack(alignment: .firstTextBaseline, spacing: EvSpace.s2) {
                Text("•").foregroundStyle(EvColor.muted)
                Text(inline(text)).font(.ev(EvType.body)).foregroundStyle(EvColor.ink)
            }
        case .numbered(let n, let text):
            HStack(alignment: .firstTextBaseline, spacing: EvSpace.s2) {
                Text("\(n).").foregroundStyle(EvColor.muted).monospacedDigit()
                Text(inline(text)).font(.ev(EvType.body)).foregroundStyle(EvColor.ink)
            }
        case .paragraph(let text):
            Text(inline(text)).font(.ev(EvType.body)).foregroundStyle(EvColor.ink).lineSpacing(5)
        case .rule:
            Rectangle().fill(EvColor.hairline).frame(height: 1).padding(.vertical, EvSpace.s2)
        }
    }

    /// Bold / italic / links inside a block.
    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}
