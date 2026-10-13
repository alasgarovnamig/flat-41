import SwiftUI
import EvTapCore

/// Settings: language (az / ru / en, synced to the server locale), appearance, push, legal, logout and
/// in-app account deletion (App Store 5.1.1(v)) with a double confirmation.
struct SettingsView: View {
    @Environment(Preferences.self) private var preferences
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(\.openURL) private var openURL
    @State private var pushOn = AppServices.shared.push.isEnabled
    @State private var showPushDenied = false
    @State private var deleteStep = 0
    @State private var deleting = false
    @State private var confirmLogout = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s5) {
                VStack(alignment: .leading, spacing: EvSpace.s2) {
                    FieldLabel(text: L("settings.language"))
                    Segmented(options: Lang.allCases, selection: Binding(get: { preferences.lang }, set: { changeLanguage($0) })) { $0.nativeName }
                }
                VStack(alignment: .leading, spacing: EvSpace.s2) {
                    FieldLabel(text: L("settings.theme"))
                    Segmented(options: ThemePreference.allCases, selection: Binding(get: { preferences.theme }, set: { preferences.theme = $0 })) {
                        switch $0 {
                        case .system: return L("settings.themeSystem")
                        case .light: return L("settings.themeLight")
                        case .dark: return L("settings.themeDark")
                        }
                    }
                }

                if session.isSignedIn {
                    FieldLabel(text: L("settings.account"))
                    RowGroup {
                        ListRow(icon: "person", title: L("settings.editProfile")) { router.push(.editProfile) }
                        RowDivider()
                        ToggleRow(title: L("settings.push"), hint: L("settings.pushHint"), isOn: Binding(get: { pushOn }, set: { togglePush($0) }))
                            .padding(.horizontal, EvSpace.s4)
                            .padding(.vertical, EvSpace.s2)
                    }
                }

                FieldLabel(text: L("settings.legal"))
                RowGroup {
                    ListRow(icon: "doc.plaintext", title: L("profile.terms")) { router.push(.page(slug: "terms")) }
                    RowDivider()
                    ListRow(icon: "lock.shield", title: L("profile.privacy")) { router.push(.page(slug: "privacy")) }
                    RowDivider()
                    ListRow(icon: "info.circle", title: L("profile.about")) { router.push(.page(slug: "about")) }
                }

                if session.isSignedIn {
                    PrimaryButton(title: L("common.logout"), icon: "rectangle.portrait.and.arrow.right", kind: .secondary) { confirmLogout = true }
                    RowGroup {
                        ListRow(icon: "trash", title: L("settings.deleteAccount"), destructive: true, showsChevron: false) { deleteStep = 1 }
                            .disabled(deleting)
                    }
                }

                Text("\(L("settings.app")): EvTap · \(L("profile.version", ["v": AppConfig.version]))")
                    .font(.ev(EvType.caption))
                    .foregroundStyle(EvColor.muted)
                    .frame(maxWidth: .infinity)
            }
            .padding(EvSize.gutter)
        }
        .evScreen(L("settings.title"))
        .overlay { if deleting { LoadingView().background(EvColor.scrim) } }
        .alert(L("settings.pushDenied"), isPresented: $showPushDenied) {
            Button(L("common.cancel"), role: .cancel) {}
            Button(L("profile.settings")) {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
        }
        .alert(L("common.logout"), isPresented: $confirmLogout) {
            Button(L("common.cancel"), role: .cancel) {}
            Button(L("common.logout"), role: .destructive) {
                Task {
                    await session.logout()
                    router.popToRoot()
                }
            }
        } message: {
            Text(L("settings.logoutConfirm"))
        }
        .alert(L("settings.deleteTitle"), isPresented: Binding(get: { deleteStep == 1 }, set: { if !$0 && deleteStep == 1 { deleteStep = 0 } })) {
            Button(L("common.cancel"), role: .cancel) { deleteStep = 0 }
            Button(L("common.delete"), role: .destructive) { deleteStep = 2 }
        } message: {
            Text(L("settings.deleteText"))
        }
        .alert(L("settings.deleteFinal"), isPresented: Binding(get: { deleteStep == 2 }, set: { if !$0 && deleteStep == 2 { deleteStep = 0 } })) {
            Button(L("common.cancel"), role: .cancel) { deleteStep = 0 }
            Button(L("settings.deleteAccount"), role: .destructive) { Task { await deleteAccount() } }
        }
    }

    private func changeLanguage(_ lang: Lang) {
        guard lang != preferences.lang else { return }
        preferences.lang = lang
        // Server-side locale drives push / SMS language.
        if session.isSignedIn {
            Task { _ = try? await AppServices.shared.api.send(API.updateMe(UpdateMeInput(locale: lang))) }
        }
    }

    private func togglePush(_ on: Bool) {
        pushOn = on
        Task {
            if on {
                if await AppServices.shared.push.enable() == .denied {
                    pushOn = false
                    showPushDenied = true
                }
            } else {
                await AppServices.shared.push.disable()
            }
        }
    }

    private func deleteAccount() async {
        deleting = true
        defer { deleting = false }
        do {
            _ = try await AppServices.shared.api.send(API.deleteMe())
            await session.logout()
            AppServices.shared.toast.show(L("settings.deleted"), kind: .success)
            router.popToRoot()
            router.select(.home)
        } catch {
            AppServices.shared.toast.error(error)
        }
        deleteStep = 0
    }
}
