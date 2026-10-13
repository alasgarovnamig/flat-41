package i18n

import "testing"

func TestDictionariesComplete(t *testing.T) {
	for lang, d := range dicts {
		for k := range en {
			if d[k] == "" {
				t.Errorf("%s: missing %s", lang, k)
			}
		}
		if len(d) != len(en) {
			t.Errorf("%s has %d keys, en has %d", lang, len(d), len(en))
		}
		for _, code := range []string{"DO_NOT_HONOR", "INSUFFICIENT_FUNDS", "EXPIRED_CARD", "PROCESSING_ERROR", "3DS_FAILED", "TOKEN_INVALID"} {
			if Decline(lang, code) == "" {
				t.Errorf("%s: missing decline %s", lang, code)
			}
		}
	}
}

func TestTranslate(t *testing.T) {
	if got := (Translator{"en"}).T("pay", "amount", "15.00 ₼"); got != "Pay 15.00 ₼" {
		t.Error(got)
	}
	if got := (Translator{"az"}).T("pay", "amount", "15.00 ₼"); got != "15.00 ₼ ödə" {
		t.Error(got)
	}
	if got := (Translator{"ru"}).T("wrongOtp", "n", 2); got != "Неверный пароль. Осталось попыток: 2" {
		t.Error(got)
	}
	if Resolve("de", "az") != "az" || Resolve("ru", "az") != "ru" || Decline("en", "") != "" {
		t.Error("resolve / decline")
	}
}
