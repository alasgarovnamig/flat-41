import MapKit
import PhotosUI
import SwiftUI
import EvTapCore

/// 6-step post / edit wizard: type → location (map pin) → details → photos → price & contact → review.
struct PostWizardView: View {
    @State private var vm: PostWizardViewModel
    @State private var confirmDiscard = false
    @Environment(\.dismiss) private var dismiss
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(editId: String?) {
        _vm = State(initialValue: PostWizardViewModel(editId: editId))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                progressHeader
                ScrollView {
                    VStack(alignment: .leading, spacing: EvSpace.s5) {
                        switch vm.step {
                        case 0: TypeStep(vm: vm)
                        case 1: LocationStep(vm: vm)
                        case 2: DetailsStep(vm: vm)
                        case 3: PhotosStep(vm: vm)
                        case 4: PriceStep(vm: vm)
                        default: ReviewStep(vm: vm)
                        }
                    }
                    .padding(EvSize.gutter)
                    .id(vm.step)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .appBackground()
            .navigationTitle(vm.editId == nil ? L("post.title") : L("post.editTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    IconButton(systemName: "xmark", label: L("common.close"), style: .sunken, size: 36) {
                        if vm.editId == nil { confirmDiscard = true } else { dismiss() }
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { footer }
            .overlay { if vm.loadingExisting { LoadingView().background(EvColor.canvas.opacity(0.6)) } }
            .confirmationDialog(L("post.discardTitle"), isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button(L("post.discard"), role: .destructive) { dismiss() }
                Button(L("common.cancel"), role: .cancel) {}
            } message: {
                Text(L("post.discardText"))
            }
        }
        .interactiveDismissDisabled()
        .task { await vm.loadExisting() }
        .animation(EvMotion.curve(reduceMotion: reduceMotion), value: vm.step)
    }

    private var progressHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(L("post.step", ["n": vm.step + 1, "total": PostWizardViewModel.steps.count]))
                    .font(.ev(EvType.caption))
                    .foregroundStyle(EvColor.muted)
                Spacer()
                Text(L("post.steps.\(PostWizardViewModel.steps[vm.step])"))
                    .font(.ev(EvType.label))
                    .foregroundStyle(EvColor.ink)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    HatchPattern().stroke(EvColor.subtle, lineWidth: 1).clipShape(Capsule())
                    Capsule().fill(EvColor.ink).frame(width: geo.size.width * vm.progress)
                }
            }
            .frame(height: 10)
        }
        .padding(.horizontal, EvSize.gutter)
        .padding(.bottom, EvSpace.s2)
        .accessibilityElement(children: .combine)
    }

    private var footer: some View {
        HStack(spacing: EvSpace.s2) {
            if vm.step > 0 {
                PrimaryButton(title: L("common.back"), kind: .secondary) { vm.back() }
                    .frame(maxWidth: 140)
            }
            if vm.step < PostWizardViewModel.steps.count - 1 {
                PrimaryButton(title: L("common.next"), isLoading: vm.step == 3 && vm.isUploading) { vm.next() }
            } else {
                PrimaryButton(title: vm.editId == nil ? L("post.submit") : L("post.saveChanges"), isLoading: vm.submitting) {
                    Task { await submit() }
                }
                .disabled(vm.isUploading)
            }
        }
        .padding(.horizontal, EvSize.gutter)
        .padding(.vertical, EvSpace.s3)
        .evGlass(in: Rectangle())
    }

    private func submit() async {
        guard let result = await vm.submit() else { return }
        dismiss()
        switch result {
        case .needsFee(let id): router.push(.listingFee(listingId: id))
        case .submitted(let id): router.push(.promote(listingId: id, upsell: true))
        case .updated: break
        }
    }
}

// MARK: - Steps

private struct TypeStep: View {
    @Bindable var vm: PostWizardViewModel
    private let columns = [GridItem(.flexible(), spacing: EvSpace.s2), GridItem(.flexible(), spacing: EvSpace.s2), GridItem(.flexible(), spacing: EvSpace.s2)]

    var body: some View {
        Text(L("post.chooseDeal")).evText(EvType.h2).foregroundStyle(EvColor.ink)
        VStack(spacing: EvSpace.s2) {
            ForEach(DealType.allCases) { d in
                let selected = vm.dealType == d
                Button {
                    vm.dealType = d
                } label: {
                    HStack(spacing: EvSpace.s3) {
                        Image(systemName: d.icon)
                            .font(.system(size: 18))
                            .foregroundStyle(selected ? EvColor.onInk : EvColor.ink)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(selected ? EvColor.ink : EvColor.surfaceSunken))
                            .accessibilityHidden(true)
                        Text(LE("dealType", d.rawValue)).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                        Spacer()
                        Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(selected ? EvColor.ink : EvColor.subtle)
                            .accessibilityHidden(true)
                    }
                    .padding(EvSpace.s3)
                    .background(CardSurface(radius: EvRadius.lg, fill: selected ? EvColor.surfaceRaised : EvColor.surface))
                    .overlay(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous).strokeBorder(EvColor.ink, lineWidth: selected ? 1.5 : 0))
                }
                .buttonStyle(EvPressStyle())
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        Text(L("post.chooseProperty")).evText(EvType.h2).foregroundStyle(EvColor.ink)
        LazyVGrid(columns: columns, spacing: EvSpace.s2) {
            ForEach(PropertyType.allCases) { p in
                let selected = vm.propertyType == p
                Button {
                    vm.propertyType = p
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: p.icon).font(.system(size: 20, weight: .light)).accessibilityHidden(true)
                        Text(LE("propertyType", p.rawValue))
                            .font(.ev(EvType.caption, weight: .medium))
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(selected ? EvColor.onInk : EvColor.ink)
                    .frame(maxWidth: .infinity, minHeight: 88)
                    .background(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous).fill(selected ? EvColor.ink : EvColor.surfaceRaised))
                }
                .buttonStyle(EvPressStyle())
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        if vm.propertyType == .APARTMENT {
            Segmented(options: BuildingType.allCases, selection: $vm.buildingType) { LE("buildingType", $0.rawValue) }
        }
    }
}

private struct LocationStep: View {
    @Bindable var vm: PostWizardViewModel
    @State private var position: MapCameraPosition = .automatic

    private var locations: Locations { AppServices.shared.locations }

    var body: some View {
        SelectField(label: L("search.city"), options: locations.cities.map { PickerOption(id: $0.id, title: $0.name.current) },
                    selection: Binding(get: { vm.cityId.map { [$0] } ?? [] }, set: { new in
                        vm.cityChanged(new.first)
                        recenter()
                    }), error: vm.error("cityId"))
        let districts = locations.districts(of: vm.cityId)
        if !districts.isEmpty {
            SelectField(label: L("search.district"), options: districts.map { PickerOption(id: $0.id, title: $0.name.current) },
                        selection: $vm.districtId.asSet)
        }
        let metros = locations.metros(of: vm.cityId)
        if !metros.isEmpty {
            SelectField(label: L("search.metro"), options: metros.map { PickerOption(id: $0.id, title: $0.name.current, dotColor: $0.line.color) },
                        selection: $vm.metroId.asSet)
        }
        EvTextField(label: L("post.address"), text: $vm.address, error: vm.error("address"), contentType: .fullStreetAddress, maxLength: 200)

        HStack {
            FieldLabel(text: L("post.pinOnMap"))
            Spacer()
            Button {
                Task {
                    await vm.useMyLocation()
                    if let c = vm.coordinate { position = .region(MKCoordinateRegion(center: c, span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01))) }
                }
            } label: {
                HStack(spacing: 6) {
                    if vm.locating { ProgressView().tint(EvColor.ink) } else { Image(systemName: "location") }
                    Text(L("post.useMyLocation")).font(.ev(EvType.label))
                }
                .foregroundStyle(EvColor.ink)
                .padding(.horizontal, EvSpace.s3)
                .frame(minHeight: EvSize.touch)
                .background(Capsule().fill(EvColor.pill))
            }
            .buttonStyle(EvPressStyle())
        }
        MapReader { proxy in
            Map(position: $position) {
                if let c = vm.coordinate {
                    Annotation("", coordinate: c) {
                        Image(systemName: "house.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(EvColor.onInk)
                            .frame(width: 38, height: 38)
                            .background(Circle().fill(EvColor.ink))
                            .overlay(Circle().stroke(EvColor.surfaceRaised, lineWidth: 2))
                    }
                    .annotationTitles(.hidden)
                }
            }
            .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll, showsTraffic: false))
            .onTapGesture { point in
                if let c = proxy.convert(point, from: .local) { vm.coordinate = c }
            }
        }
        .frame(height: 260)
        .clipShape(RoundedRectangle(cornerRadius: EvRadius.xl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: EvRadius.xl, style: .continuous).strokeBorder(EvColor.hairline))
        .accessibilityLabel(L("post.pinOnMap"))
        .accessibilityHint(L("post.tapToPin"))
        .onAppear { recenter() }
        Text(vm.coordinate.map { String(format: "%.5f, %.5f", $0.latitude, $0.longitude) } ?? L("post.tapToPin"))
            .font(.ev(EvType.caption))
            .foregroundStyle(EvColor.muted)
    }

    private func recenter() {
        let center: CLLocationCoordinate2D
        if let c = vm.coordinate {
            center = c
        } else if let city = locations.city(vm.cityId) {
            center = CLLocationCoordinate2D(latitude: city.lat, longitude: city.lng)
        } else {
            center = CLLocationCoordinate2D(latitude: 40.4093, longitude: 49.8671)
        }
        position = .region(MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: vm.coordinate == nil ? 0.12 : 0.01, longitudeDelta: vm.coordinate == nil ? 0.12 : 0.01)))
    }
}

private struct DetailsStep: View {
    @Bindable var vm: PostWizardViewModel

    var body: some View {
        HStack(alignment: .top, spacing: EvSpace.s2) {
            EvTextField(label: "\(L("listing.area")), \(L("common.m2"))", text: $vm.area.numeric(decimal: true), error: vm.error("area"), keyboard: .decimalPad)
            if vm.hasLand {
                EvTextField(label: "\(L("listing.landArea")), \(L("common.sot"))", text: $vm.landArea.numeric(decimal: true), error: vm.error("landArea"), keyboard: .decimalPad)
            }
        }
        if vm.hasRooms {
            FieldLabel(text: L("listing.rooms"))
            FlowLayout {
                ForEach(1...8, id: \.self) { r in
                    SelectChip(title: r == 8 ? "8+" : "\(r)", isSelected: vm.rooms == r, minWidth: 44) { vm.rooms = r }
                }
            }
            if let e = vm.error("rooms") { Text(e).font(.ev(EvType.caption)).foregroundStyle(EvColor.danger) }
            EvTextField(label: L("listing.bathrooms"), text: $vm.bathrooms.numeric(), error: vm.error("bathrooms"), keyboard: .numberPad)
        }
        if vm.isApartmentLike || vm.propertyType == .COMMERCIAL {
            HStack(alignment: .top, spacing: EvSpace.s2) {
                EvTextField(label: L("listing.floor"), text: $vm.floor.numeric(), error: vm.error("floor"), keyboard: .numberPad)
                EvTextField(label: L("listing.totalFloors"), text: $vm.totalFloors.numeric(), error: vm.error("totalFloors"), keyboard: .numberPad)
            }
        }
        if vm.propertyType != .LAND {
            HStack(alignment: .top, spacing: EvSpace.s2) {
                EvTextField(label: L("listing.yearBuilt"), text: $vm.yearBuilt.numeric(), error: vm.error("yearBuilt"), keyboard: .numberPad)
                EvTextField(label: "\(L("listing.ceilingHeight")), m", text: $vm.ceilingHeight.numeric(decimal: true), error: vm.error("ceilingHeight"), keyboard: .decimalPad)
            }
            FieldLabel(text: L("listing.repair"))
            FlowLayout {
                ForEach(RepairType.allCases) { r in
                    SelectChip(title: LE("repair", r.rawValue), isSelected: vm.repair == r) { vm.repair = vm.repair == r ? nil : r }
                }
            }
        }
        if vm.dealType == .SALE {
            VStack(spacing: 0) {
                ToggleRow(title: L("search.hasDocument"), isOn: $vm.hasDocument)
                ToggleRow(title: L("search.mortgage"), isOn: $vm.mortgageAvailable)
            }
        }
        if vm.isDaily {
            Card(title: L("post.daily")) {
                VStack(spacing: EvSpace.s3) {
                    HStack(alignment: .top, spacing: EvSpace.s2) {
                        EvTextField(label: L("listing.maxGuests"), text: $vm.maxGuests.numeric(), error: vm.error("maxGuests"), keyboard: .numberPad)
                        EvTextField(label: L("listing.minNights"), text: $vm.minNights.numeric(), error: vm.error("minNights"), keyboard: .numberPad)
                    }
                    HStack(alignment: .top, spacing: EvSpace.s2) {
                        EvTextField(label: L("listing.checkInTime"), text: $vm.checkInTime, placeholder: "14:00", error: vm.error("checkInTime"), keyboard: .numbersAndPunctuation, maxLength: 5)
                        EvTextField(label: L("listing.checkOutTime"), text: $vm.checkOutTime, placeholder: "12:00", error: vm.error("checkOutTime"), keyboard: .numbersAndPunctuation, maxLength: 5)
                    }
                    EvTextField(label: L("listing.houseRules"), text: $vm.houseRules, error: vm.error("houseRules"), multiline: true, maxLength: 2000)
                }
            }
        }
        FieldLabel(text: L("listing.amenities"))
        FlowLayout {
            ForEach(Amenity.allCases) { a in
                SelectChip(title: LE("amenity", a.rawValue), isSelected: vm.amenities.contains(a)) {
                    if let i = vm.amenities.firstIndex(of: a) { vm.amenities.remove(at: i) } else { vm.amenities.append(a) }
                }
            }
        }
    }
}

private struct PhotosStep: View {
    @Bindable var vm: PostWizardViewModel
    @State private var picked: [PhotosPickerItem] = []
    @State private var showCamera = false
    private let columns = [GridItem(.flexible(), spacing: EvSpace.s2), GridItem(.flexible(), spacing: EvSpace.s2), GridItem(.flexible(), spacing: EvSpace.s2)]

    var body: some View {
        Text(L("post.addPhotos")).evText(EvType.h2).foregroundStyle(EvColor.ink)
        Text(L("post.photosHint")).font(.ev(EvType.body)).foregroundStyle(EvColor.muted)
        HStack(spacing: EvSpace.s2) {
            PhotosPicker(selection: $picked, maxSelectionCount: max(1, PostWizardViewModel.maxPhotos - vm.photos.count), selectionBehavior: .ordered, matching: .images) {
                Label(L("post.gallery"), systemImage: "photo.on.rectangle")
                    .font(.ev(EvType.bodyStrong))
                    .foregroundStyle(EvColor.ink)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(Capsule().fill(EvColor.pill))
            }
            .disabled(vm.photos.count >= PostWizardViewModel.maxPhotos)
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                PrimaryButton(title: L("post.camera"), icon: "camera", kind: .secondary) { showCamera = true }
                    .disabled(vm.photos.count >= PostWizardViewModel.maxPhotos)
            }
        }
        if let e = vm.error("imageIds") { Text(e).font(.ev(EvType.caption)).foregroundStyle(EvColor.danger) }
        Text("\(vm.photos.count) / \(PostWizardViewModel.maxPhotos)").font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
        LazyVGrid(columns: columns, spacing: EvSpace.s2) {
            ForEach(Array(vm.photos.enumerated()), id: \.element.id) { i, photo in
                photoCell(photo, index: i)
            }
        }
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            let copy = items
            picked = []
            Task { await vm.addPicked(copy) }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { data in Task { await vm.addCamera(data) } }
                .ignoresSafeArea()
        }
    }

    private func photoCell(_ photo: WizardPhoto, index: Int) -> some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let data = photo.preview, let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    RemoteImage(url: photo.remoteURL, placeholderIcon: "photo")
                }
            }
            .overlay {
                switch photo.status {
                case .uploading:
                    ZStack { EvColor.scrim; ProgressView().tint(.white) }
                        .accessibilityLabel(L("post.uploadingShort"))
                case .failed:
                    Button {
                        vm.retry(photo.id)
                    } label: {
                        ZStack {
                            EvColor.danger.opacity(0.75)
                            VStack(spacing: 2) {
                                Image(systemName: "arrow.clockwise")
                                Text(L("post.uploadFailed")).font(.ev(EvType.caption, size: 10))
                            }
                            .foregroundStyle(.white)
                        }
                    }
                    .buttonStyle(.plain)
                case .done:
                    EmptyView()
                }
            }
            .overlay(alignment: .topLeading) {
                if index == 0 {
                    Text(L("post.cover"))
                        .font(.ev(EvType.caption, weight: .semibold, size: 10))
                        .foregroundStyle(EvColor.onInk)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(EvColor.ink))
                        .padding(6)
                }
            }
            .overlay(alignment: .topTrailing) {
                IconButton(systemName: "xmark", label: L("common.delete"), style: .glass, size: 28) { vm.remove(photo.id) }
                    .padding(-6)
            }
            .overlay(alignment: .bottom) {
                HStack {
                    IconButton(systemName: "chevron.left", label: L("post.moveLeft"), style: .glass, size: 26) { vm.move(photo.id, by: -1) }
                        .disabled(index == 0)
                        .opacity(index == 0 ? 0.3 : 1)
                    Spacer()
                    IconButton(systemName: "chevron.right", label: L("post.moveRight"), style: .glass, size: 26) { vm.move(photo.id, by: 1) }
                        .disabled(index == vm.photos.count - 1)
                        .opacity(index == vm.photos.count - 1 ? 0.3 : 1)
                }
                .padding(-6)
            }
            .clipShape(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).strokeBorder(index == 0 ? EvColor.ink : EvColor.hairline, lineWidth: index == 0 ? 2 : 1))
            .contextMenu {
                if index > 0 { Button(L("post.makeCover"), systemImage: "star") { vm.makeCover(photo.id) } }
                Button(L("common.delete"), systemImage: "trash", role: .destructive) { vm.remove(photo.id) }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(L("listing.photoN", ["n": index + 1, "total": vm.photos.count]))
            .accessibilityAction(named: L("post.makeCover")) { vm.makeCover(photo.id) }
    }
}

private struct PriceStep: View {
    @Bindable var vm: PostWizardViewModel

    private var priceLabel: String {
        switch vm.dealType {
        case .RENT_DAILY?: return "\(L("post.price")) \(L("common.perNight"))"
        case .RENT_LONG?: return "\(L("post.price")) \(L("common.perMonth"))"
        default: return L("post.price")
        }
    }

    var body: some View {
        EvTextField(label: priceLabel, text: $vm.price.numeric(), error: vm.error("price"), keyboard: .numberPad)
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: EvSpace.s2) {
                ForEach(Currency.allCases) { c in
                    SelectChip(title: "\(c.rawValue) \(c.symbol)", isSelected: vm.currency == c) { vm.currency = c }
                }
            }
        }
        EvTextField(label: L("post.titleField"), text: $vm.title, placeholder: L("post.titleHint"), error: vm.error("title"),
                    hint: "\(vm.title.count)/120", maxLength: 120)
        EvTextField(label: L("post.descriptionField"), text: $vm.description, placeholder: L("post.descriptionHint"), error: vm.error("description"),
                    hint: "\(vm.description.count)/5000", multiline: true, maxLength: 5000)
        EvTextField(label: L("post.contactName"), text: $vm.contactName, error: vm.error("contactName"), contentType: .name, autocapitalization: .words)
        EvTextField(label: L("post.contactPhone"),
                    text: Binding(get: { Format.localPhone(vm.contactPhoneDigits) }, set: { vm.contactPhoneDigits = Format.sanitizeLocalInput($0) }),
                    placeholder: "50 123 45 67", prefix: "+994", error: vm.error("contactPhone"), keyboard: .phonePad, contentType: .telephoneNumber)
    }
}

private struct ReviewStep: View {
    @Bindable var vm: PostWizardViewModel

    var body: some View {
        Text(L("post.review")).evText(EvType.h2).foregroundStyle(EvColor.ink)
        VStack(alignment: .leading, spacing: 0) {
            if let first = vm.photos.first {
                Color.clear
                    .aspectRatio(4 / 3, contentMode: .fit)
                    .overlay {
                        if let data = first.preview, let image = UIImage(data: data) {
                            Image(uiImage: image).resizable().scaledToFill()
                        } else {
                            RemoteImage(url: first.remoteURL)
                        }
                    }
                    .clipped()
            }
            VStack(alignment: .leading, spacing: 6) {
                if let p = Int(vm.price) {
                    MoneyText(parts: Format.priceParts(p, vm.currency), style: EvType.h1)
                }
                Text(vm.title.isEmpty ? "—" : vm.title).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                Text(summary).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                Text(L("common.photos", ["n": vm.photos.count])).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
            }
            .padding(EvSpace.s4)
        }
        .background(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous).fill(EvColor.surfaceRaised))
        .clipShape(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous))
        .evCardShadow()

        if !vm.errors.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(vm.errors.keys.sorted(), id: \.self) { k in
                    Text("• \(L("post.field.\(k)")): \(vm.error(k) ?? "")").font(.ev(EvType.caption)).foregroundStyle(EvColor.danger)
                }
            }
            .padding(EvSpace.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(EvColor.dangerBg))
        }
        if let q = vm.quotaText {
            NoticeBanner(text: q.text, tone: q.paid ? .warning : .info, icon: q.paid ? "creditcard" : "gift")
        }
    }

    private var summary: String {
        var parts: [String] = []
        if let d = vm.dealType { parts.append(LE("dealType", d.rawValue)) }
        if let p = vm.propertyType { parts.append(LE("propertyType", p.rawValue)) }
        if let r = vm.rooms { parts.append(L("common.roomsShort", ["n": r])) }
        if !vm.area.isEmpty { parts.append("\(vm.area) \(L("common.m2"))") }
        let place = [vm.address.isEmpty ? nil : vm.address, AppServices.shared.locations.city(vm.cityId)?.name.current].compactMap { $0 }.joined(separator: ", ")
        if !place.isEmpty { parts.append(place) }
        return parts.joined(separator: " · ")
    }
}

extension PropertyType {
    var icon: String {
        switch self {
        case .APARTMENT: return "building.2"
        case .HOUSE: return "house"
        case .OFFICE: return "briefcase"
        case .COMMERCIAL: return "storefront"
        case .LAND: return "leaf"
        case .GARAGE: return "car"
        case .ROOM: return "bed.double"
        }
    }
}

/// Camera capture (SwiftUI has no camera picker) → JPEG data.
struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (Data) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    @MainActor
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.92) {
                parent.onImage(data)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
