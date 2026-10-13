import SwiftUI
import EvTapCore

@MainActor
@Observable
final class MortgageViewModel {
    static let downOptions = [10, 20, 30, 40, 50]
    static let termOptions = [5, 10, 15, 20, 25]

    let price: Int
    let listingId: String?
    private(set) var banks: [MortgageBank] = []
    var bankCode: String?
    var downPercent = 20
    var years = 15

    init(price: Int, listingId: String?) {
        self.price = price
        self.listingId = listingId
    }

    var bank: MortgageBank? { banks.first { $0.code == bankCode } ?? banks.first }
    var rate: Double { bank?.annualRate ?? 12 }
    var downPayment: Int { Int((Double(price) * Double(downPercent) / 100).rounded()) }
    var monthly: Double { Format.mortgageMonthly(principal: Double(price - downPayment), annualRatePercent: rate, years: years) }
    var downChoices: [Int] { Self.downOptions.filter { Double($0) >= (bank?.minDownPaymentPercent ?? 0) } }
    var termChoices: [Int] { Self.termOptions.filter { $0 <= (bank?.maxTermYears ?? 30) } }

    func load() async {
        guard banks.isEmpty, let list = try? await AppServices.shared.api.send(API.mortgageBanks()) else { return }
        banks = list
        normalize()
    }

    func normalize() {
        if !downChoices.contains(downPercent), let first = downChoices.first { downPercent = first }
        if !termChoices.contains(years), let last = termChoices.last { years = last }
    }

    func sendLead(name: String, localPhone: String) async -> Bool {
        guard let phone = Validation.phoneFromLocal(localPhone) else {
            AppServices.shared.toast.show(L("validation.phone"), kind: .error)
            return false
        }
        do {
            _ = try await AppServices.shared.api.send(API.mortgageLead(MortgageLeadInput(
                name: name.trimmingCharacters(in: .whitespaces), phone: phone, listingId: listingId, price: price,
                downPayment: downPayment, termYears: years, bankCode: bank?.code)))
            AppServices.shared.toast.show(L("mortgage.sent"), kind: .success)
            return true
        } catch {
            AppServices.shared.toast.error(error)
            return false
        }
    }
}

/// Bank chips, down payment and term chips, monthly payment as a big number, lead form.
struct MortgageCalculatorView: View {
    let currency: Currency
    @State private var vm: MortgageViewModel
    @State private var showApply = false

    init(price: Int, currency: Currency, listingId: String?) {
        self.currency = currency
        _vm = State(initialValue: MortgageViewModel(price: price, listingId: listingId))
    }

    var body: some View {
        Card(title: L("mortgage.title")) {
            VStack(alignment: .leading, spacing: EvSpace.s4) {
                if !vm.banks.isEmpty {
                    FieldLabel(text: L("mortgage.bank"))
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: EvSpace.s2) {
                            ForEach(vm.banks) { b in
                                SelectChip(title: "\(b.name) · \(Format.number(b.annualRate))%", isSelected: vm.bank?.code == b.code) {
                                    vm.bankCode = b.code
                                    vm.normalize()
                                }
                            }
                        }
                    }
                }
                FieldLabel(text: "\(L("mortgage.downPayment")): \(Format.price(vm.downPayment, currency))")
                FlowLayout {
                    ForEach(vm.downChoices, id: \.self) { p in
                        SelectChip(title: "\(p)%", isSelected: vm.downPercent == p, minWidth: 56) { vm.downPercent = p }
                    }
                }
                FieldLabel(text: L("mortgage.term"))
                FlowLayout {
                    ForEach(vm.termChoices, id: \.self) { y in
                        SelectChip(title: "\(y) \(L("common.yearsShort"))", isSelected: vm.years == y, minWidth: 56) { vm.years = y }
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(L("mortgage.monthly")) · \(L("mortgage.rate")) \(Format.number(vm.rate))%")
                        .font(.ev(EvType.label, weight: .regular))
                        .foregroundStyle(EvColor.muted)
                    MoneyText(parts: Format.priceParts(Int(vm.monthly.rounded()), currency), style: EvType.number, suffix: L("common.perMonth"))
                }
                .padding(EvSpace.s4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous).fill(EvColor.highlightBg))
                PrimaryButton(title: L("mortgage.apply"), kind: .secondary) { showApply = true }
            }
        }
        .task { await vm.load() }
        .sheet(isPresented: $showApply) {
            MortgageLeadSheet(summary: "\(Format.price(vm.price, currency)) · \(L("mortgage.downPayment")) \(Format.price(vm.downPayment, currency)) · \(vm.years) \(L("common.yearsShort"))") { name, phone in
                await vm.sendLead(name: name, localPhone: phone)
            }
        }
    }
}

private struct MortgageLeadSheet: View {
    let summary: String
    let onSend: (String, String) async -> Bool

    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var phone = ""
    @State private var sending = false

    var body: some View {
        EvSheet(title: L("mortgage.applyTitle")) {
            EvTextField(label: L("mortgage.name"), text: $name, contentType: .name)
            EvTextField(label: L("mortgage.phone"), text: Binding(get: { Format.localPhone(phone) }, set: { phone = Format.sanitizeLocalInput($0) }),
                        placeholder: "50 123 45 67", prefix: "+994", keyboard: .phonePad, contentType: .telephoneNumber)
            Text(summary).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
        } footer: {
            PrimaryButton(title: L("common.send"), isLoading: sending) {
                Task {
                    sending = true
                    let ok = await onSend(name, phone)
                    sending = false
                    if ok { dismiss() }
                }
            }
            .disabled(name.trimmingCharacters(in: .whitespaces).count < 2 || phone.count < 9)
        }
        .presentationDetents([.medium])
        .onAppear {
            if name.isEmpty { name = session.me?.name ?? "" }
            if phone.isEmpty { phone = Format.localDigits(session.me?.phone) }
        }
    }
}
