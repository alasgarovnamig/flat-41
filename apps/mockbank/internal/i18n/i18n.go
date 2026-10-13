// Package i18n holds the az / ru / en texts of the hosted checkout.
package i18n

import (
	"fmt"
	"strings"
)

// Languages supported by the checkout, in switcher order.
var Languages = []string{"az", "ru", "en"}

// LanguageNames are the labels of the language switcher.
var LanguageNames = map[string]string{"az": "AZ", "ru": "RU", "en": "EN"}

// IsLanguage reports whether v is a supported language code.
func IsLanguage(v string) bool {
	for _, l := range Languages {
		if l == v {
			return true
		}
	}
	return false
}

// Resolve returns v when it is a supported language, otherwise fallback.
func Resolve(v, fallback string) string {
	if IsLanguage(v) {
		return v
	}
	return fallback
}

type dict map[string]string

var en = dict{
	"htmlTitle":           "Secure payment",
	"testMode":            "TEST MODE",
	"merchant":            "Merchant",
	"amount":              "Amount",
	"order":               "Order",
	"description":         "Description",
	"cardNumber":          "Card number",
	"expiry":              "Expiry date",
	"expiryPlaceholder":   "MM/YY",
	"cvv":                 "CVV",
	"cvvHint":             "3 digits on the back of the card",
	"holder":              "Cardholder name",
	"holderPlaceholder":   "NAME SURNAME",
	"saveCard":            "Save card for future payments",
	"saveCardHint":        "Only a secure token is stored, never your card number.",
	"pay":                 "Pay {amount}",
	"processing":          "Processing…",
	"cancel":              "Cancel",
	"cancelPayment":       "Cancel payment",
	"secureNote":          "Your payment is protected with 3-D Secure and 256-bit encryption.",
	"expiresIn":           "Session expires in {time}",
	"formError":           "Please check the highlighted fields.",
	"numberInvalid":       "Enter a valid card number",
	"expiryInvalid":       "Enter the expiry date as MM/YY",
	"expiryPast":          "This card has expired",
	"cvvInvalid":          "Enter the 3-digit security code",
	"holderInvalid":       "Enter the name as shown on the card",
	"staleForm":           "This form is out of date. Please try again.",
	"testCards":           "Test cards",
	"testCardsHint":       "Any future expiry date and any CVV. Tap a card to fill in the form.",
	"outcomeFrictionless": "Approved (no 3-D Secure)",
	"outcome3ds":          "3-D Secure → approved",
	"outcomeDeclined":     "Declined",
	"outcomeOther":        "Any other valid card number",
	"acsTitle":            "Purchase authentication",
	"acsIntro":            "A one-time password has been sent to your mobile phone{phone}. Enter it to confirm this purchase.",
	"acsMerchant":         "Merchant",
	"acsAmount":           "Amount",
	"acsDate":             "Date",
	"acsCard":             "Card number",
	"otp":                 "One-time password",
	"confirm":             "Confirm",
	"resend":              "Resend code",
	"resent":              "A new code has been sent to your phone.",
	"wrongOtp":            "Incorrect password. Attempts left: {n}",
	"testOtp":             "Test OTP: {otp}",
	"acsFooter":           "Verified by Visa · Mastercard Identity Check (simulated)",
	"approvedTitle":       "Payment successful",
	"declinedTitle":       "Payment declined",
	"cancelledTitle":      "Payment cancelled",
	"expiredTitle":        "Payment session expired",
	"expiredText":         "This payment was not completed in time. Please start again from the merchant site.",
	"refundedTitle":       "Payment refunded",
	"cancelledText":       "No money has been charged.",
	"redirecting":         "Returning to {merchant} in a moment…",
	"returnTo":            "Return to {merchant}",
	"approvalCode":        "Authorization code",
	"rrn":                 "Reference (RRN)",
	"card":                "Card",
	"date":                "Date",
	"notFoundTitle":       "Payment not found",
	"notFoundText":        "This payment link is invalid or no longer available.",
	"securedBy":           "Secured by Mock Bank",
	"language":            "Language",
}

var az = dict{
	"htmlTitle":           "Təhlükəsiz ödəniş",
	"testMode":            "TEST REJİMİ",
	"merchant":            "Satıcı",
	"amount":              "Məbləğ",
	"order":               "Sifariş",
	"description":         "Təyinat",
	"cardNumber":          "Kartın nömrəsi",
	"expiry":              "Bitmə tarixi",
	"expiryPlaceholder":   "AA/İİ",
	"cvv":                 "CVV",
	"cvvHint":             "Kartın arxasındakı 3 rəqəm",
	"holder":              "Kart sahibinin adı",
	"holderPlaceholder":   "AD SOYAD",
	"saveCard":            "Kartı gələcək ödənişlər üçün yadda saxla",
	"saveCardHint":        "Kart nömrəniz deyil, yalnız təhlükəsiz token saxlanılır.",
	"pay":                 "{amount} ödə",
	"processing":          "Emal olunur…",
	"cancel":              "Ləğv et",
	"cancelPayment":       "Ödənişi ləğv et",
	"secureNote":          "Ödənişiniz 3-D Secure və 256-bit şifrələmə ilə qorunur.",
	"expiresIn":           "Sessiyanın bitməsinə {time} qalıb",
	"formError":           "Qeyd olunmuş xanaları yoxlayın.",
	"numberInvalid":       "Düzgün kart nömrəsi daxil edin",
	"expiryInvalid":       "Tarixi AA/İİ formatında daxil edin",
	"expiryPast":          "Kartın müddəti bitib",
	"cvvInvalid":          "3 rəqəmli təhlükəsizlik kodunu daxil edin",
	"holderInvalid":       "Adı kartda göstərildiyi kimi daxil edin",
	"staleForm":           "Forma köhnəlib. Yenidən cəhd edin.",
	"testCards":           "Test kartları",
	"testCardsHint":       "İstənilən gələcək tarix və istənilən CVV. Formu doldurmaq üçün karta toxunun.",
	"outcomeFrictionless": "Təsdiq (3-D Secure-suz)",
	"outcome3ds":          "3-D Secure → təsdiq",
	"outcomeDeclined":     "İmtina",
	"outcomeOther":        "Hər hansı digər düzgün kart nömrəsi",
	"acsTitle":            "Alışın təsdiqi",
	"acsIntro":            "Bir dəfəlik şifrə mobil telefonunuza{phone} göndərildi. Alışı təsdiqləmək üçün onu daxil edin.",
	"acsMerchant":         "Satıcı",
	"acsAmount":           "Məbləğ",
	"acsDate":             "Tarix",
	"acsCard":             "Kartın nömrəsi",
	"otp":                 "Bir dəfəlik şifrə",
	"confirm":             "Təsdiqlə",
	"resend":              "Kodu yenidən göndər",
	"resent":              "Telefonunuza yeni kod göndərildi.",
	"wrongOtp":            "Şifrə yanlışdır. Qalan cəhdlər: {n}",
	"testOtp":             "Test OTP: {otp}",
	"acsFooter":           "Verified by Visa · Mastercard Identity Check (simulyasiya)",
	"approvedTitle":       "Ödəniş uğurla tamamlandı",
	"declinedTitle":       "Ödəniş rədd edildi",
	"cancelledTitle":      "Ödəniş ləğv edildi",
	"expiredTitle":        "Ödəniş sessiyasının vaxtı bitdi",
	"expiredText":         "Ödəniş vaxtında tamamlanmadı. Satıcının saytından yenidən başlayın.",
	"refundedTitle":       "Ödəniş geri qaytarıldı",
	"cancelledText":       "Kartınızdan heç bir vəsait tutulmayıb.",
	"redirecting":         "Bir neçə saniyəyə {merchant} saytına qayıdırsınız…",
	"returnTo":            "{merchant} saytına qayıt",
	"approvalCode":        "Avtorizasiya kodu",
	"rrn":                 "İstinad (RRN)",
	"card":                "Kart",
	"date":                "Tarix",
	"notFoundTitle":       "Ödəniş tapılmadı",
	"notFoundText":        "Bu ödəniş linki yanlışdır və ya artıq mövcud deyil.",
	"securedBy":           "Mock Bank tərəfindən qorunur",
	"language":            "Dil",
}

var ru = dict{
	"htmlTitle":           "Безопасная оплата",
	"testMode":            "ТЕСТОВЫЙ РЕЖИМ",
	"merchant":            "Продавец",
	"amount":              "Сумма",
	"order":               "Заказ",
	"description":         "Назначение",
	"cardNumber":          "Номер карты",
	"expiry":              "Срок действия",
	"expiryPlaceholder":   "ММ/ГГ",
	"cvv":                 "CVV",
	"cvvHint":             "3 цифры на обороте карты",
	"holder":              "Имя владельца карты",
	"holderPlaceholder":   "ИМЯ ФАМИЛИЯ",
	"saveCard":            "Сохранить карту для будущих платежей",
	"saveCardHint":        "Хранится только защищённый токен, а не номер карты.",
	"pay":                 "Оплатить {amount}",
	"processing":          "Обработка…",
	"cancel":              "Отмена",
	"cancelPayment":       "Отменить платёж",
	"secureNote":          "Платёж защищён технологией 3-D Secure и 256-битным шифрованием.",
	"expiresIn":           "Сессия истекает через {time}",
	"formError":           "Проверьте отмеченные поля.",
	"numberInvalid":       "Введите корректный номер карты",
	"expiryInvalid":       "Введите срок в формате ММ/ГГ",
	"expiryPast":          "Срок действия карты истёк",
	"cvvInvalid":          "Введите 3-значный код безопасности",
	"holderInvalid":       "Введите имя как на карте",
	"staleForm":           "Форма устарела. Попробуйте ещё раз.",
	"testCards":           "Тестовые карты",
	"testCardsHint":       "Любой будущий срок и любой CVV. Нажмите на карту, чтобы заполнить форму.",
	"outcomeFrictionless": "Одобрено (без 3-D Secure)",
	"outcome3ds":          "3-D Secure → одобрено",
	"outcomeDeclined":     "Отказ",
	"outcomeOther":        "Любой другой корректный номер",
	"acsTitle":            "Подтверждение покупки",
	"acsIntro":            "Одноразовый пароль отправлен на ваш мобильный телефон{phone}. Введите его, чтобы подтвердить покупку.",
	"acsMerchant":         "Продавец",
	"acsAmount":           "Сумма",
	"acsDate":             "Дата",
	"acsCard":             "Номер карты",
	"otp":                 "Одноразовый пароль",
	"confirm":             "Подтвердить",
	"resend":              "Отправить код повторно",
	"resent":              "Новый код отправлен на ваш телефон.",
	"wrongOtp":            "Неверный пароль. Осталось попыток: {n}",
	"testOtp":             "Тестовый OTP: {otp}",
	"acsFooter":           "Verified by Visa · Mastercard Identity Check (симуляция)",
	"approvedTitle":       "Оплата прошла успешно",
	"declinedTitle":       "Платёж отклонён",
	"cancelledTitle":      "Платёж отменён",
	"expiredTitle":        "Время сессии оплаты истекло",
	"expiredText":         "Платёж не был завершён вовремя. Начните заново на сайте продавца.",
	"refundedTitle":       "Платёж возвращён",
	"cancelledText":       "Деньги не списаны.",
	"redirecting":         "Сейчас вы вернётесь в {merchant}…",
	"returnTo":            "Вернуться в {merchant}",
	"approvalCode":        "Код авторизации",
	"rrn":                 "Референс (RRN)",
	"card":                "Карта",
	"date":                "Дата",
	"notFoundTitle":       "Платёж не найден",
	"notFoundText":        "Ссылка на оплату недействительна или больше не доступна.",
	"securedBy":           "Защищено Mock Bank",
	"language":            "Язык",
}

var dicts = map[string]dict{"az": az, "ru": ru, "en": en}

var declines = map[string]map[string]string{
	"en": {
		"DO_NOT_HONOR":       "The card issuer declined the payment. Please use another card or contact your bank.",
		"INSUFFICIENT_FUNDS": "There are not enough funds on the card.",
		"EXPIRED_CARD":       "The card has expired.",
		"PROCESSING_ERROR":   "A processing error occurred. Please try again later.",
		"3DS_FAILED":         "3-D Secure authentication failed.",
		"TOKEN_INVALID":      "The saved card is no longer valid.",
	},
	"az": {
		"DO_NOT_HONOR":       "Kartı buraxan bank ödənişi rədd etdi. Başqa kartdan istifadə edin və ya bankınızla əlaqə saxlayın.",
		"INSUFFICIENT_FUNDS": "Kartda kifayət qədər vəsait yoxdur.",
		"EXPIRED_CARD":       "Kartın müddəti bitib.",
		"PROCESSING_ERROR":   "Emal xətası baş verdi. Bir az sonra yenidən cəhd edin.",
		"3DS_FAILED":         "3-D Secure təsdiqi uğursuz oldu.",
		"TOKEN_INVALID":      "Yadda saxlanmış kart artıq etibarlı deyil.",
	},
	"ru": {
		"DO_NOT_HONOR":       "Банк-эмитент отклонил платёж. Используйте другую карту или обратитесь в банк.",
		"INSUFFICIENT_FUNDS": "Недостаточно средств на карте.",
		"EXPIRED_CARD":       "Срок действия карты истёк.",
		"PROCESSING_ERROR":   "Ошибка обработки. Повторите попытку позже.",
		"3DS_FAILED":         "Не пройдена проверка 3-D Secure.",
		"TOKEN_INVALID":      "Сохранённая карта больше недействительна.",
	},
}

// Translator translates checkout texts for one language.
type Translator struct{ Lang string }

// T returns the text for key with {name} placeholders replaced by the given
// name/value pairs: T("pay", "amount", "15.00 ₼").
func (t Translator) T(key string, pairs ...any) string {
	s, ok := dicts[t.Lang][key]
	if !ok {
		s, ok = en[key]
	}
	if !ok {
		s = key
	}
	for i := 0; i+1 < len(pairs); i += 2 {
		s = strings.ReplaceAll(s, "{"+fmt.Sprint(pairs[i])+"}", fmt.Sprint(pairs[i+1]))
	}
	return s
}

// Decline returns the customer-facing decline message (empty when code is empty).
func Decline(lang, code string) string {
	if code == "" {
		return ""
	}
	if m, ok := declines[lang]; ok {
		return m[code]
	}
	return declines["en"][code]
}
