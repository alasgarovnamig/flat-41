import MapKit
import SwiftUI
import EvTapCore

/// Map mode: muted MapKit style, black price pills / count clusters, region-change refetch (`/listings/map?bbox=`).
struct SearchMapView: View {
    @Bindable var vm: SearchViewModel
    @State private var position: MapCameraPosition = .automatic
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Map(position: $position) {
            ForEach(vm.clusters) { cluster in
                Annotation("", coordinate: CLLocationCoordinate2D(latitude: cluster.lat, longitude: cluster.lng), anchor: .center) {
                    pin(cluster)
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll, showsTraffic: false))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .onMapCameraChange(frequency: .onEnd) { context in
            vm.regionChanged(context.region)
        }
        .onAppear {
            position = .region(vm.initialRegion)
        }
        .overlay(alignment: .top) {
            HStack(spacing: EvSpace.s2) {
                if vm.mapLimitReached {
                    Text(L("search.mapLimit"))
                        .font(.ev(EvType.caption))
                        .foregroundStyle(EvColor.ink)
                        .padding(.horizontal, EvSpace.s3)
                        .padding(.vertical, 8)
                        .evGlass(in: Capsule())
                }
                if vm.mapLoading {
                    ProgressView()
                        .tint(EvColor.ink)
                        .padding(10)
                        .evGlass(in: Circle())
                        .accessibilityLabel(L("common.loading"))
                }
            }
            .padding(.top, EvSpace.s3)
        }
        .overlay(alignment: .bottom) {
            if let point = vm.selectedPoint {
                MapPointCard(point: point) { router.push(.listing(id: point.id)) } onClose: { vm.selectedPointId = nil }
                    .padding(.horizontal, EvSize.gutter)
                    .padding(.bottom, EvSpace.s3)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(EvMotion.curve(reduceMotion: reduceMotion), value: vm.selectedPointId)
    }

    @ViewBuilder private func pin(_ cluster: MapClustering.Cluster) -> some View {
        if cluster.isSingle, let p = cluster.points.first {
            let selected = p.id == vm.selectedPointId
            Button {
                vm.selectedPointId = selected ? nil : p.id
            } label: {
                Text("\(Format.shortPrice(p.price)) \(p.currency.symbol)")
                    .font(.ev(EvType.caption, weight: .semibold, size: 12))
                    .foregroundStyle(selected ? EvColor.ink : EvColor.onInk)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 28)
                    .background(Capsule().fill(selected ? EvColor.surfaceRaised : EvColor.ink))
                    .overlay(Capsule().strokeBorder(p.isPremium || p.isVip ? EvColor.accent : EvColor.ink, lineWidth: p.isPremium || p.isVip ? 2 : 1))
                    .evCardShadow()
                    .padding(8) // 44pt target
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(p.title), \(PriceText.listing(p.price, p.currency, p.pricePeriod))")
        } else {
            Button {
                zoom(into: cluster)
            } label: {
                Text("\(cluster.count)")
                    .font(.ev(EvType.label, weight: .semibold))
                    .foregroundStyle(EvColor.onInk)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(EvColor.ink))
                    .overlay(Circle().stroke(EvColor.surfaceRaised, lineWidth: 2))
                    .evCardShadow()
                    .padding(4)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L("search.results", ["n": cluster.count]))
        }
    }

    private func zoom(into cluster: MapClustering.Cluster) {
        let lats = cluster.points.map(\.lat)
        let lngs = cluster.points.map(\.lng)
        let span = MKCoordinateSpan(latitudeDelta: max(0.005, (lats.max()! - lats.min()!) * 2.2),
                                    longitudeDelta: max(0.005, (lngs.max()! - lngs.min()!) * 2.2))
        let region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: cluster.lat, longitude: cluster.lng), span: span)
        if reduceMotion {
            position = .region(region)
        } else {
            withAnimation(.easeInOut(duration: EvMotion.slow)) { position = .region(region) }
        }
    }
}

/// Compact card for the selected map pin.
struct MapPointCard: View {
    let point: MapPoint
    let onOpen: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: EvSpace.s3) {
            RemoteImage(url: AppServices.shared.api.mediaURL(point.coverUrl))
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    if point.isPremium { Badge(text: L("badge.premium"), kind: .premium) }
                    if point.isVip { Badge(text: L("badge.vip"), kind: .vip) }
                }
                Text(point.title)
                    .font(.ev(EvType.bodyStrong))
                    .foregroundStyle(EvColor.ink)
                    .lineLimit(2)
                MoneyText(listingPrice: point.price, currency: point.currency, period: point.pricePeriod, style: EvType.h3)
            }
            Spacer(minLength: 0)
            VStack {
                IconButton(systemName: "xmark", label: L("common.close"), style: .sunken, size: 32, action: onClose)
                Spacer()
                IconButton(systemName: "arrow.up.right", label: L("myListings.view"), style: .ink, size: 36, action: onOpen)
            }
        }
        .padding(EvSpace.s3)
        .frame(height: 112)
        .background(CardSurface(radius: EvRadius.xl, fill: EvColor.surfaceRaised))
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .accessibilityElement(children: .contain)
    }
}
