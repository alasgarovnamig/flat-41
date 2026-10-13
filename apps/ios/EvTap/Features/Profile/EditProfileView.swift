import PhotosUI
import SwiftUI
import EvTapCore

@MainActor
@Observable
final class EditProfileViewModel {
    var name = ""
    var email = ""
    private(set) var avatarUrl: String?
    private(set) var phone: String?
    private(set) var uploading = false
    private(set) var saving = false
    private(set) var errors: ValidationErrors = [:]

    func fill() {
        guard let me = AppServices.shared.session.me else { return }
        name = me.name
        email = me.email ?? ""
        avatarUrl = me.avatarUrl
        phone = me.phone
    }

    func pickAvatar(_ item: PhotosPickerItem) async {
        uploading = true
        defer { uploading = false }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let jpeg = await ImageProcessing.prepareForUpload(data, maxPixel: 512)
        guard let jpeg else { return }
        do {
            avatarUrl = try await AppServices.shared.api.upload(jpeg, filename: "avatar.jpg").url
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    func save() async -> Bool {
        errors = Validation.profile(name: name, email: email)
        guard errors.isEmpty else { return false }
        saving = true
        defer { saving = false }
        let trimmedEmail = email.trimmingCharacters(in: .whitespaces).lowercased()
        let absoluteAvatar: String?? = .some(avatarUrl.flatMap { AppServices.shared.api.mediaURL($0)?.absoluteString })
        do {
            _ = try await AppServices.shared.api.send(API.updateMe(UpdateMeInput(
                name: name.trimmingCharacters(in: .whitespaces), email: trimmedEmail.isEmpty ? nil : trimmedEmail, avatarUrl: absoluteAvatar)))
            await AppServices.shared.session.refreshMe()
            AppServices.shared.toast.show(L("common.saved"), kind: .success)
            return true
        } catch {
            AppServices.shared.toast.error(error)
            return false
        }
    }
}

struct EditProfileView: View {
    @State private var vm = EditProfileViewModel()
    @State private var avatarItem: PhotosPickerItem? = nil
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        RequireAuth {
            ScrollView {
                VStack(alignment: .leading, spacing: EvSpace.s4) {
                    PhotosPicker(selection: $avatarItem, matching: .images) {
                        VStack(spacing: EvSpace.s2) {
                            Avatar(url: AppServices.shared.api.mediaURL(vm.avatarUrl), name: vm.name, size: 96)
                                .overlay { if vm.uploading { ProgressView().tint(EvColor.ink) } }
                            Text(L("settings.changeAvatar")).font(.ev(EvType.label)).foregroundStyle(EvColor.ink).underline()
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .accessibilityLabel(L("settings.changeAvatar"))
                    EvTextField(label: L("settings.name"), text: $vm.name, error: vm.errors["name"].map { L($0) }, contentType: .name, autocapitalization: .words)
                    EvTextField(label: L("settings.email"), text: $vm.email, error: vm.errors["email"].map { L($0) }, keyboard: .emailAddress,
                                contentType: .emailAddress, autocapitalization: .never)
                    if let phone = vm.phone {
                        EvTextField(label: L("auth.phone"), text: .constant(Format.phone(phone)), disabled: true)
                    }
                    PrimaryButton(title: L("common.save"), isLoading: vm.saving) {
                        Task { if await vm.save() { dismiss() } }
                    }
                    .disabled(vm.uploading)
                }
                .padding(EvSize.gutter)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .evScreen(L("settings.editProfile"))
        .onAppear { vm.fill() }
        .onChange(of: avatarItem) { _, item in
            guard let item else { return }
            Task { await vm.pickAvatar(item) }
        }
    }
}
