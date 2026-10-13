package wallet

import "testing"

// Ported from apps/api/test/money.test.ts ("wallet debit split (bonus first)").

func TestSplitDebitBonusFirst(t *testing.T) {
	if got := SplitDebit(1000, 300, 500, ""); got != (Split{OK: true, FromBonus: 300, FromReal: 200}) {
		t.Errorf("bonus spent first: %+v", got)
	}
	if got := SplitDebit(1000, 800, 500, BonusFirst); got != (Split{OK: true, FromBonus: 500, FromReal: 0}) {
		t.Errorf("bonus covers all: %+v", got)
	}
}

func TestSplitDebitInsufficient(t *testing.T) {
	if SplitDebit(100, 300, 500, "").OK {
		t.Error("100 + 300 bonus cannot cover 500")
	}
}

func TestSplitDebitSources(t *testing.T) {
	if got := SplitDebit(1000, 300, 500, RealOnly); got != (Split{OK: true, FromBonus: 0, FromReal: 500}) {
		t.Errorf("REAL_ONLY: %+v", got)
	}
	if SplitDebit(1000, 300, 500, BonusOnly).OK {
		t.Error("BONUS_ONLY with 300 bonus cannot cover 500")
	}
}

func TestFormatMoney(t *testing.T) {
	for in, want := range map[int]string{1050: "10.50 ₼", 100: "1.00 ₼", 0: "0.00 ₼"} {
		if got := FormatMoney(in, "AZN"); got != want {
			t.Errorf("FormatMoney(%d) = %q", in, got)
		}
	}
	if got := FormatMoney(250, "GEL"); got != "2.50 ₾" {
		t.Errorf("GEL: %q", got)
	}
}
