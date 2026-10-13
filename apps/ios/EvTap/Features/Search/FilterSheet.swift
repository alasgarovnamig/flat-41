import SwiftUI
import EvTapCore

/// Full `listingSearchSchema` filter sheet (q / sort / bbox / page are handled by the search screen).
struct FilterSheet: View {
    let initial: ListingFilters
    let onApply: (ListingFilters) -> Void

    @State private var f = ListingFilters()
    @State private var showDates = false
    @Environment(\.dismiss) private var dismiss

    private var locations: Locations { AppServices.shared.locations }

    var body: some View {
        EvSheet(title: L("common.filters")) {
            section(L("search.dealType")) {
                Segmented(options: [""] + DealType.allCases.map(\.rawValue), selection: optionalBinding(\.dealType)) {
                    $0.isEmpty ? L("common.all") : LE("dealTypeShort", $0)
                }
            }

            section(L("search.propertyType")) {
                FlowLayout {
                    ForEach(PropertyType.allCases) { p in
                        SelectChip(title: LE("propertyType", p.rawValue), isSelected: f.propertyType.contains(p)) { toggle(&f.propertyType, p) }
                    }
                }
            }

            if f.propertyType.isEmpty || f.propertyType.contains(.APARTMENT) {
                section(L("search.buildingType")) {
                    Segmented(options: ["", BuildingType.NEW.rawValue, BuildingType.SECONDARY.rawValue], selection: optionalBinding(\.buildingType)) {
                        $0.isEmpty ? L("common.any") : LE("buildingType", $0)
                    }
                }
            }

            section(L("search.country")) {
                Segmented(options: ["", CountryCode.AZ.rawValue, CountryCode.GE.rawValue], selection: countryBinding) { code in
                    code.isEmpty ? L("common.all") : (locations.data.countries.first { $0.code.rawValue == code }?.name.current ?? code)
                }
            }

            SelectField(label: L("search.city"), placeholder: L("search.anyCity"),
                        options: locations.cities(in: f.country).map { PickerOption(id: $0.id, title: $0.name.current) },
                        selection: cityBinding)

            let districts = locations.districts(of: f.cityId)
            SelectField(label: L("search.district"), placeholder: f.cityId == nil ? L("search.chooseCity") : L("common.any"),
                        options: districts.map { PickerOption(id: $0.id, title: $0.name.current) },
                        selection: $f.districtId.asSet, multiple: true, disabled: districts.isEmpty)

            let metros = locations.metros(of: f.cityId)
            if !metros.isEmpty {
                SelectField(label: L("search.metro"), placeholder: L("common.any"),
                            options: metros.map { PickerOption(id: $0.id, title: $0.name.current, dotColor: $0.line.color) },
                            selection: $f.metroId.asSet, multiple: true)
            }

            section(L("search.price")) {
                rangeFields(min: intBinding(\.priceMin), max: intBinding(\.priceMax))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: EvSpace.s2) {
                        ForEach(Currency.allCases) { c in
                            SelectChip(title: "\(c.rawValue) \(c.symbol)", isSelected: (f.currency ?? .AZN) == c) { f.currency = c == .AZN ? nil : c }
                        }
                    }
                }
            }

            section(L("search.area")) {
                rangeFields(min: doubleBinding(\.areaMin), max: doubleBinding(\.areaMax), decimal: true)
            }

            section(L("search.rooms")) {
                HStack(spacing: EvSpace.s2) {
                    ForEach(1...5, id: \.self) { r in
                        SelectChip(title: r == 5 ? "5+" : "\(r)", isSelected: f.rooms.contains(r), minWidth: 48) { toggle(&f.rooms, r) }
                    }
                }
            }

            section(L("search.floor")) {
                rangeFields(min: intBinding(\.floorMin), max: intBinding(\.floorMax))
                HStack(spacing: EvSpace.s2) {
                    SelectChip(title: L("search.notFirstFloor"), isSelected: f.notFirstFloor) { f.notFirstFloor.toggle() }
                    SelectChip(title: L("search.notLastFloor"), isSelected: f.notLastFloor) { f.notLastFloor.toggle() }
                }
            }

            section(L("search.repair")) {
                FlowLayout {
                    ForEach(RepairType.allCases) { r in
                        SelectChip(title: LE("repair", r.rawValue), isSelected: f.repair.contains(r)) { toggle(&f.repair, r) }
                    }
                }
            }

            section(L("search.ownerType")) {
                Segmented(options: ["", OwnerType.OWNER.rawValue, OwnerType.BUSINESS.rawValue], selection: optionalBinding(\.ownerType)) {
                    $0.isEmpty ? L("common.all") : LE("ownerType", $0)
                }
            }

            VStack(spacing: 0) {
                ToggleRow(title: L("search.hasDocument"), isOn: $f.hasDocument)
                ToggleRow(title: L("search.mortgage"), isOn: $f.mortgageAvailable)
                ToggleRow(title: L("search.withPhotos"), isOn: $f.hasPhotos)
                ToggleRow(title: L("search.verifiedOnly"), isOn: $f.verified)
            }

            if f.dealType == .RENT_DAILY {
                section(L("search.dates")) {
                    Button {
                        showDates.toggle()
                    } label: {
                        HStack {
                            Image(systemName: "calendar").accessibilityHidden(true)
                            Text(f.checkIn.map { "\(DateText.isoDayShort($0)) → \(f.checkOut.map { DateText.isoDayShort($0) } ?? "…")" } ?? L("booking.selectDates"))
                                .font(.ev(EvType.body))
                            Spacer()
                            Image(systemName: showDates ? "chevron.up" : "chevron.down").accessibilityHidden(true)
                        }
                        .foregroundStyle(EvColor.ink)
                        .padding(.horizontal, EvSpace.s4)
                        .frame(minHeight: 48)
                        .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(EvColor.surfaceRaised))
                        .overlay(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).strokeBorder(EvColor.hairline))
                    }
                    .buttonStyle(.plain)
                    if showDates {
                        MonthCalendar(from: ISODay.today(), months: 4, state: dayState, onTap: tapDay)
                    }
                    StepperRow(title: L("search.guests"), value: guestsBinding, range: 1...30)
                }
            }

            section(L("search.amenities")) {
                FlowLayout {
                    ForEach(Amenity.allCases) { a in
                        SelectChip(title: LE("amenity", a.rawValue), isSelected: f.amenities.contains(a)) { toggle(&f.amenities, a) }
                    }
                }
            }
        } footer: {
            HStack(spacing: EvSpace.s2) {
                PrimaryButton(title: L("common.reset"), kind: .secondary) { f = f.reset() }
                    .frame(maxWidth: 140)
                PrimaryButton(title: L("search.showResults")) {
                    onApply(f.cleaned())
                    dismiss()
                }
            }
        }
        .presentationDetents([.large])
        .onAppear { f = initial }
    }

    // MARK: Helpers

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: EvSpace.s2) {
            FieldLabel(text: title)
            content()
        }
    }

    private func rangeFields(min: Binding<String>, max: Binding<String>, decimal: Bool = false) -> some View {
        HStack(spacing: EvSpace.s2) {
            EvTextField(label: "", text: min.numeric(decimal: decimal), placeholder: L("common.from"), keyboard: decimal ? .decimalPad : .numberPad)
            EvTextField(label: "", text: max.numeric(decimal: decimal), placeholder: L("common.to"), keyboard: decimal ? .decimalPad : .numberPad)
        }
    }

    private func toggle<T: Equatable>(_ array: inout [T], _ value: T) {
        if let i = array.firstIndex(of: value) { array.remove(at: i) } else { array.append(value) }
    }

    private func optionalBinding<E: RawRepresentable>(_ kp: WritableKeyPath<ListingFilters, E?>) -> Binding<String> where E.RawValue == String {
        Binding(get: { f[keyPath: kp]?.rawValue ?? "" }, set: { f[keyPath: kp] = E(rawValue: $0) })
    }

    private var countryBinding: Binding<String> {
        Binding(get: { f.country?.rawValue ?? "" }, set: { new in
            f.country = CountryCode(rawValue: new)
            if let c = locations.city(f.cityId), let country = f.country, c.country != country {
                f.cityId = nil
                f.districtId = []
                f.metroId = []
            }
        })
    }

    private var cityBinding: Binding<Set<String>> {
        Binding(get: { f.cityId.map { [$0] } ?? [] }, set: { new in
            let id = new.first
            if id != f.cityId {
                f.cityId = id
                f.districtId = []
                f.metroId = []
            }
        })
    }

    private func intBinding(_ kp: WritableKeyPath<ListingFilters, Int?>) -> Binding<String> {
        Binding(get: { f[keyPath: kp].map(String.init) ?? "" }, set: { f[keyPath: kp] = Int($0) })
    }

    private func doubleBinding(_ kp: WritableKeyPath<ListingFilters, Double?>) -> Binding<String> {
        Binding(get: { f[keyPath: kp].map { Format.number($0) } ?? "" }, set: { f[keyPath: kp] = Double($0) })
    }

    private var guestsBinding: Binding<Int> {
        Binding(get: { f.guests ?? 1 }, set: { f.guests = $0 })
    }

    private func dayState(_ iso: String) -> CalendarDayState {
        let today = ISODay.today()
        if iso < today { return .past }
        if iso == f.checkIn { return f.checkOut == nil ? .selectedSingle : .selectedStart }
        if iso == f.checkOut { return .selectedEnd }
        if let a = f.checkIn, let b = f.checkOut, iso > a, iso < b { return .inRange }
        return .normal
    }

    private func tapDay(_ iso: String) {
        if let start = f.checkIn, f.checkOut == nil, iso > start {
            f.checkOut = iso
            showDates = false
        } else {
            f.checkIn = iso
            f.checkOut = nil
        }
    }
}

extension LocationsData.MetroLine {
    /// Line identity colours (information, not decoration).
    var color: Color {
        switch self {
        case .red: return EvColor.danger
        case .green: return EvColor.success
        case .purple: return .purple
        }
    }
}
