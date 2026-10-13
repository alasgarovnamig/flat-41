import SwiftUI
import EvTapCore

/// Login sheet: phone → SMS code, or e-mail / password (login + registration).
struct AuthFlowView: View {
    @State private var vm = AuthViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack(path: $vm.path) {
            PhoneLoginView(vm: vm)
                .navigationDestination(for: AuthViewModel.Step.self) { step in
                    switch step {
                    case .code: OTPVerifyView(vm: vm)
                    case .email: EmailLoginView(vm: vm)
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        IconButton(systemName: "xmark", label: L("common.close"), style: .sunken, size: 36) { dismiss() }
                    }
                }
        }
        .presentationCornerRadius(EvRadius.xl)
        .presentationBackground(EvColor.canvas)
        .interactiveDismissDisabled(vm.verifying || vm.submittingEmail)
    }
}

struct PhoneLoginView: View {
    @Bindable var vm: AuthViewModel
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s5) {
                Image(systemName: "house.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(EvColor.onInk)
                    .frame(width: 56, height: 56)
                    .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(EvColor.ink))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: EvSpace.s2) {
                    Text(L("auth.title")).evText(EvType.h1).foregroundStyle(EvColor.ink).accessibilityAddTraits(.isHeader)
                    Text(L("auth.subtitle")).font(.ev(EvType.body)).foregroundStyle(EvColor.muted)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("auth.phone")).font(.ev(EvType.label)).foregroundStyle(EvColor.inkSecondary)
                    HStack(spacing: EvSpace.s2) {
                        Text("+994").font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink).accessibilityHidden(true)
                        Rectangle().fill(EvColor.hairline).frame(width: 1, height: 22)
                        TextField("50 123 45 67", text: Binding(get: { Format.localPhone(vm.localDigits) }, set: { vm.localDigits = Format.sanitizeLocalInput($0) }))
                            .font(.ev(EvType.h3, weight: .regular))
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            .focused($focused)
                            .accessibilityLabel(L("auth.phone"))
                            .accessibilityValue("+994 \(Format.localPhone(vm.localDigits))")
                    }
                    .padding(.horizontal, EvSpace.s4)
                    .frame(minHeight: 56)
                    .background(Capsule(style: .continuous).fill(EvColor.surfaceRaised))
                    .overlay(Capsule(style: .continuous).strokeBorder(focused ? EvColor.ink : EvColor.hairline, lineWidth: focused ? 1.5 : 1))
                }
                PrimaryButton(title: L("auth.sendCode"), isLoading: vm.requesting) { Task { await vm.requestCode() } }
                    .disabled(vm.normalizedPhone == nil)
                PrimaryButton(title: L("auth.emailLogin"), icon: "envelope", kind: .ghost) { vm.path.append(.email) }
                Text(L("auth.agree"))
                    .font(.ev(EvType.caption))
                    .foregroundStyle(EvColor.muted)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
            }
            .padding(EvSpace.s6)
        }
        .scrollDismissesKeyboard(.interactively)
        .appBackground()
        .onAppear { focused = true }
    }
}

struct OTPVerifyView: View {
    @Bindable var vm: AuthViewModel
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s5) {
                VStack(alignment: .leading, spacing: EvSpace.s2) {
                    Text(L("auth.codeTitle")).evText(EvType.h1).foregroundStyle(EvColor.ink).accessibilityAddTraits(.isHeader)
                    Text(L("auth.codeSentTo", ["phone": Format.phone(vm.phoneE164 ?? "")])).font(.ev(EvType.body)).foregroundStyle(EvColor.muted)
                }

                ZStack {
                    // Hidden field receives typing / SMS AutoFill (one-time code) / paste.
                    TextField("", text: Binding(get: { vm.code }, set: { vm.codeChanged($0) }))
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .focused($focused)
                        .foregroundStyle(.clear)
                        .tint(.clear)
                        .accessibilityLabel(L("auth.codeTitle"))
                        .accessibilityValue(vm.code)
                    HStack(spacing: EvSpace.s2) {
                        ForEach(0..<6, id: \.self) { i in
                            let chars = Array(vm.code)
                            let active = i == chars.count && !vm.verifying
                            Text(i < chars.count ? String(chars[i]) : "")
                                .evText(EvType.h2, weight: .regular)
                                .foregroundStyle(EvColor.ink)
                                .frame(maxWidth: 56, minHeight: 60)
                                .frame(maxWidth: .infinity)
                                .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(EvColor.surfaceRaised))
                                .overlay(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous)
                                    .strokeBorder(vm.codeError != nil ? EvColor.danger : (active && focused ? EvColor.ink : EvColor.hairline), lineWidth: active ? 1.5 : 1))
                        }
                    }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
                .onTapGesture { focused = true }

                if let err = vm.codeError {
                    Label(err, systemImage: "exclamationmark.circle").font(.ev(EvType.caption)).foregroundStyle(EvColor.danger)
                }

                if let dev = vm.devCode {
                    Button {
                        vm.codeChanged(dev)
                    } label: {
                        Label(L("auth.devCode", ["code": dev]), systemImage: "hammer")
                            .font(.ev(EvType.label))
                            .foregroundStyle(EvColor.ink)
                            .frame(maxWidth: .infinity, minHeight: EvSize.touch)
                            .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(EvColor.highlightBg))
                    }
                    .buttonStyle(.plain)
                }

                EvTextField(label: "\(L("auth.name")) (\(L("common.optional")))", text: $vm.name, hint: L("auth.nameHint"),
                            contentType: .name, autocapitalization: .words, maxLength: 80)

                PrimaryButton(title: L("common.continue"), isLoading: vm.verifying) { Task { await vm.verify() } }
                    .disabled(vm.code.count < 4)

                Group {
                    if vm.secondsLeft > 0 {
                        Text(L("auth.resendIn", ["s": vm.secondsLeft]))
                            .font(.ev(EvType.label, weight: .regular))
                            .foregroundStyle(EvColor.muted)
                            .frame(maxWidth: .infinity, minHeight: EvSize.touch)
                            .monospacedDigit()
                    } else {
                        PrimaryButton(title: L("auth.resend"), kind: .ghost) { Task { await vm.resend() } }
                    }
                }
                PrimaryButton(title: L("auth.changeNumber"), kind: .ghost) { dismiss() }
            }
            .padding(EvSpace.s6)
        }
        .scrollDismissesKeyboard(.interactively)
        .appBackground()
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { focused = true }
    }
}

struct EmailLoginView: View {
    @Bindable var vm: AuthViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s4) {
                Text(vm.isRegister ? L("auth.signUp") : L("auth.signIn")).evText(EvType.h1).foregroundStyle(EvColor.ink)
                Segmented(options: [false, true], selection: $vm.isRegister) { $0 ? L("auth.signUp") : L("auth.signIn") }
                if vm.isRegister {
                    EvTextField(label: L("auth.name"), text: $vm.regName, error: vm.emailErrors["name"].map { L($0) },
                                contentType: .name, autocapitalization: .words)
                    EvTextField(label: L("auth.email"), text: $vm.email, error: vm.emailErrors["email"].map { L($0) },
                                keyboard: .emailAddress, contentType: .emailAddress, autocapitalization: .never)
                } else {
                    EvTextField(label: L("auth.login"), text: $vm.login, error: vm.emailErrors["login"].map { L($0) },
                                keyboard: .emailAddress, contentType: .username, autocapitalization: .never)
                }
                EvTextField(label: L("auth.password"), text: $vm.password, error: vm.emailErrors["password"].map { L($0) },
                            contentType: vm.isRegister ? .newPassword : .password, autocapitalization: .never, secure: true)
                PrimaryButton(title: vm.isRegister ? L("auth.signUp") : L("auth.signIn"), isLoading: vm.submittingEmail) {
                    Task { await vm.submitEmail() }
                }
                PrimaryButton(title: L("auth.phoneLogin"), icon: "iphone", kind: .ghost) { vm.path.removeAll() }
            }
            .padding(EvSpace.s6)
        }
        .scrollDismissesKeyboard(.interactively)
        .appBackground()
        .navigationBarTitleDisplayMode(.inline)
    }
}
