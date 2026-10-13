import SwiftUI

/// Fullscreen photo pager with pinch-to-zoom (double-tap toggles zoom; buttons as alternatives to gestures).
struct GalleryView: View {
    let urls: [URL]
    @State private var index: Int
    @Environment(\.dismiss) private var dismiss

    init(urls: [URL], startIndex: Int) {
        self.urls = urls
        _index = State(initialValue: min(max(0, startIndex), max(0, urls.count - 1)))
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(urls.indices, id: \.self) { i in
                    ZoomableImage(url: urls[i])
                        .tag(i)
                        .accessibilityLabel(L("listing.photoN", ["n": i + 1, "total": urls.count]))
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()

            HStack {
                Text("\(index + 1) / \(urls.count)")
                    .font(.ev(EvType.label))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(.white.opacity(0.15)))
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(.white.opacity(0.15)))
                }
                .accessibilityLabel(L("common.close"))
            }
            .padding(.horizontal, EvSize.gutter)
            .padding(.top, EvSpace.s2)
        }
        .statusBarHidden()
        .accessibilityAction(.escape) { dismiss() }
    }
}

private struct ZoomableImage: View {
    let url: URL
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        AsyncImage(url: url) { phase in
            if case .success(let image) = phase {
                image.resizable().scaledToFit()
            } else if case .failure = phase {
                Image(systemName: "photo").font(.largeTitle).foregroundStyle(.white.opacity(0.5))
            } else {
                ProgressView().tint(.white)
            }
        }
        .scaleEffect(scale)
        .offset(offset)
        .gesture(
            MagnifyGesture()
                .onChanged { value in scale = min(4, max(1, lastScale * value.magnification)) }
                .onEnded { _ in
                    lastScale = scale
                    if scale <= 1 { reset() }
                }
        )
        .simultaneousGesture(
            DragGesture(minimumDistance: scale > 1 ? 0 : 1000)
                .onChanged { value in
                    guard scale > 1 else { return }
                    offset = CGSize(width: lastOffset.width + value.translation.width, height: lastOffset.height + value.translation.height)
                }
                .onEnded { _ in lastOffset = offset }
        )
        .onTapGesture(count: 2) {
            if scale > 1 { reset() } else { scale = 2.5; lastScale = 2.5 }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }
}
