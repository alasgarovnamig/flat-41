import Foundation
import Observation
import EvTapCore

@MainActor
@Observable
final class AuthViewModel {
    enum Step: Hashable { case code, email }

    // Phone
    var localDigits = ""
    private(set) var requesting = false
    private(set) var phoneE164: String?
    private(set) var devCode: String?
    private(set) var secondsLeft = 0
    // Code
    var code = ""
    var name = ""
    private(set) var verifying = false
    private(set) var codeError: String?
    // Email
    var isRegister = false
    var login = ""
    var email = ""
    var password = ""
    var regName = ""
    private(set) var emailErrors: ValidationErrors = [:]
    private(set) var submittingEmail = false

    var path: [Step] = []
    @ObservationIgnored private var timer: Task<Void, Never>?

    var normalizedPhone: String? { Validation.phoneFromLocal(localDigits) }

    /// `POST /auth/otp/request` → code step.
    func requestCode() async {
        guard let phone = normalizedPhone, !requesting else { return }
        requesting = true
        defer { requesting = false }
        do {
            let r = try await AppServices.shared.api.send(API.requestOtp(phone: phone))
            phoneE164 = phone
            devCode = (r.devCode?.isEmpty == false) ? r.devCode : nil
            code = ""
            codeError = nil
            startTimer(r.retryAfter ?? 60)
            if path.last != .code { path.append(.code) }
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    func resend() async {
        guard let phone = phoneE164 else { return }
        do {
            let r = try await AppServices.shared.api.send(API.requestOtp(phone: phone))
            devCode = (r.devCode?.isEmpty == false) ? r.devCode : nil
            startTimer(r.retryAfter ?? 60)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    /// Called on every change of the code field: digits only, auto-submits at 6 digits.
    func codeChanged(_ new: String) {
        let digits = String(new.filter(\.isNumber).prefix(6))
        if digits != code { code = digits }
        codeError = nil
        if digits.count == 6 && !verifying { Task { await verify() } }
    }

    func verify() async {
        guard let phone = phoneE164, Validation.isOtpCode(code), !verifying else { return }
        verifying = true
        defer { verifying = false }
        do {
            let trimmed = name.trimmingCharacters(in: .whitespaces)
            let res = try await AppServices.shared.api.send(API.verifyOtp(OtpVerifyInput(phone: phone, code: code, name: trimmed.count >= 2 ? trimmed : nil)))
            await finish(res)
        } catch {
            code = ""
            codeError = L(error: error)
        }
    }

    func submitEmail() async {
        let errors = isRegister ? Validation.register(name: regName, email: email, password: password) : Validation.login(login: login, password: password)
        emailErrors = errors
        guard errors.isEmpty else { return }
        submittingEmail = true
        defer { submittingEmail = false }
        do {
            let res: AuthResponse
            if isRegister {
                res = try await AppServices.shared.api.send(API.register(RegisterInput(
                    name: regName.trimmingCharacters(in: .whitespaces), email: email.trimmingCharacters(in: .whitespaces).lowercased(), password: password)))
            } else {
                res = try await AppServices.shared.api.send(API.login(LoginInput(login: login.trimmingCharacters(in: .whitespaces), password: password)))
            }
            await finish(res)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    private func finish(_ res: AuthResponse) async {
        timer?.cancel()
        await AppServices.shared.session.signIn(res)
        AppServices.shared.router.authCompleted()
    }

    private func startTimer(_ seconds: Int) {
        timer?.cancel()
        secondsLeft = seconds
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let self, !Task.isCancelled else { return }
                self.secondsLeft = max(0, self.secondsLeft - 1)
                if self.secondsLeft == 0 { return }
            }
        }
    }
}
