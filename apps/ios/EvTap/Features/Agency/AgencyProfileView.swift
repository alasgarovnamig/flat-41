import PhotosUI
import SwiftUI
import EvTapCore

@MainActor
@Observable
final class AgencyViewModel {
    private(set) var agency: Agency?
    private(set) var stats: AgencyStats?
    private(set) var loading = false
    private(set) var loadError: Error?
    private(set) var saving = false
    private(set) var uploadingLogo = false
    private(set) var errors: ValidationErrors = [:]

    var name = ""
    var type: AgencyType = .AGENCY
    var description = ""
    var phoneDigits = ""
    var email = ""
    var website = ""
    var address = ""
    var cityId: String? = "baku"
    var logoUrl: String?

    var exists: Bool { agency != nil }

    func load() async {
        loading = true
        defer { loading = false }
        do {
            let a = try await AppServices.shared.api.send(API.myAgency())
            fill(a)
            loadError = nil
            stats = try? await AppServices.shared.api.send(API.agencyStats(days: 30))
        } catch let e as APIError where e.isNotFound || e.code == .NO_AGENCY {
            agency = nil // no agency yet → create form
            loadError = nil
        } catch {
            loadError = error
        }
    }

    private func fill(_ a: Agency) {
        agency = a
        name = a.name
        type = a.type
        description = a.description ?? ""
        phoneDigits = Format.localDigits(a.phone)
        email = a.email ?? ""
        website = a.website ?? ""
        address = a.address ?? ""
        cityId = a.cityId
        logoUrl = a.logoUrl
    }

    private func nonEmpty(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    func save() async {
        let input = AgencyInput(name: name.trimmingCharacters(in: .whitespaces), type: type, description: nonEmpty(description),
                                phone: phoneDigits.isEmpty ? nil : "+994\(phoneDigits)", email: nonEmpty(email), website: nonEmpty(website),
                                address: nonEmpty(address), cityId: cityId, logoUrl: logoUrl.flatMap { AppServices.shared.api.mediaURL($0)?.absoluteString })
        errors = Validation.agency(input)
        guard errors.isEmpty else { return }
        saving = true
        defer { saving = false }
        do {
            let a = try await AppServices.shared.api.send(exists ? API.updateMyAgency(input) : API.createAgency(input))
            fill(a)
            AppServices.shared.toast.show(L("common.saved"), kind: .success)
            AppServices.shared.bus.bump(.me)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    func uploadLogo(_ item: PhotosPickerItem) async {
        uploadingLogo = true
        defer { uploadingLogo = false }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let jpeg = await ImageProcessing.prepareForUpload(data, maxPixel: 512)
        guard let jpeg else { return }
        do {
            logoUrl = try await AppServices.shared.api.upload(jpeg, filename: "logo.jpg").url
        } catch {
            AppServices.shared.toast.error(error)
        }
    }
}

/// Create / edit the agency (user becomes BUSINESS); logo upload; 30-day stats when the agency exists.
struct AgencyProfileView: View {
    @State private var vm = AgencyViewModel()
    @State private var logoItem: PhotosPickerItem? = nil

    private var locations: Locations { AppServices.shared.locations }

    var body: some View {
        RequireAuth {
            Group {
                if vm.loading && vm.agency == nil && vm.loadError == nil {
                    LoadingView()
                } else if let e = vm.loadError {
                    ErrorStateView(error: e) { Task { await vm.load() } }
                } else {
                    form
                }
            }
        }
        .evScreen(L("agency.title"))
        .task { await vm.load() }
        .onChange(of: logoItem) { _, item in
            guard let item else { return }
            Task { await vm.uploadLogo(item) }
        }
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s4) {
                if let a = vm.agency {
                    StatusPill(text: a.verified ? L("agency.verified") : L("agency.notVerified"), tone: a.verified ? .success : .warning)
                } else {
                    NoticeBanner(text: L("agency.createHint"), tone: .info)
                }
                if let s = vm.stats { statsSection(s) }

                PhotosPicker(selection: $logoItem, matching: .images) {
                    VStack(spacing: EvSpace.s2) {
                        Avatar(url: AppServices.shared.api.mediaURL(vm.logoUrl), name: vm.name.isEmpty ? "A" : vm.name, size: 88)
                            .overlay { if vm.uploadingLogo { ProgressView().tint(EvColor.ink) } }
                        Text(L("agency.logo")).font(.ev(EvType.label)).foregroundStyle(EvColor.ink).underline()
                    }
                    .frame(maxWidth: .infinity)
                }
                .accessibilityLabel(L("agency.logo"))

                EvTextField(label: L("agency.name"), text: $vm.name, error: vm.errors["name"].map { L($0) }, contentType: .organizationName)
                FieldLabel(text: L("agency.type"))
                Segmented(options: AgencyType.allCases, selection: $vm.type) { LE("agencyType", $0.rawValue) }
                SelectField(label: L("agency.city"), options: locations.cities.map { PickerOption(id: $0.id, title: $0.name.current) }, selection: $vm.cityId.asSet)
                EvTextField(label: L("agency.address"), text: $vm.address, error: vm.errors["address"].map { L($0) }, contentType: .fullStreetAddress)
                EvTextField(label: L("agency.phone"), text: Binding(get: { Format.localPhone(vm.phoneDigits) }, set: { vm.phoneDigits = Format.sanitizeLocalInput($0) }),
                            placeholder: "50 123 45 67", prefix: "+994", error: vm.errors["phone"].map { L($0) }, keyboard: .phonePad, contentType: .telephoneNumber)
                EvTextField(label: L("agency.email"), text: $vm.email, error: vm.errors["email"].map { L($0) }, keyboard: .emailAddress,
                            contentType: .emailAddress, autocapitalization: .never)
                EvTextField(label: L("agency.website"), text: $vm.website, placeholder: "https://", error: vm.errors["website"].map { L($0) },
                            keyboard: .URL, contentType: .URL, autocapitalization: .never)
                EvTextField(label: L("agency.description"), text: $vm.description, error: vm.errors["description"].map { L($0) }, multiline: true, maxLength: 5000)
                PrimaryButton(title: vm.exists ? L("common.save") : L("agency.create"), isLoading: vm.saving) { Task { await vm.save() } }
            }
            .padding(EvSize.gutter)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func statsSection(_ s: AgencyStats) -> some View {
        VStack(spacing: EvSpace.s3) {
            HStack(spacing: EvSpace.s3) {
                StatCard(label: L("myListings.views"), value: Format.grouped(s.views), caption: L("agency.last30"), spark: s.daily.map(\.value))
                StatCard(label: L("myListings.phoneViews"), value: Format.grouped(s.phoneViews), caption: L("agency.last30"))
            }
            SplitMeter(left: .init(label: L("myListings.messages"), value: Format.grouped(s.messages), amount: Double(s.messages)),
                       right: .init(label: L("agency.activeListings"), value: Format.grouped(s.listings), amount: Double(s.listings)))
                .evCard()
        }
    }
}
