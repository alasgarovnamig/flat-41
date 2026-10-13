# EvTap — Pazar analizi ve gelir modeli

> Tüm fiyatlar varsayılandır ve **admin panelinden (Ayarlar / Kataloq)** kod değiştirmeden güncellenebilir.
> Kaynak: `packages/shared/src/pricing.ts` (ilk kurulumda veritabanına yazılır).

## 1. Rakip analizi

| | **bina.az** (AZ) | **ev10.az** (AZ) | **myhome.ge** (GE) | **home.ss.ge** (GE) | **Airbnb** (global) |
|---|---|---|---|---|---|
| Ana model | İlan + ücretli öne çıkarma | İlan + öne çıkarma, daha basit UX | İlan + VIP katmanları + ajans paketleri | İlan + VIP/Super VIP + renkli vurgu | Rezervasyon komisyonu |
| Ücretsiz ilan | Sınırlı (bireysel), ajanslara ücretli | Var | Var (sınırlı) | Var | Ev sahibi için ücretsiz |
| Öne çıkarma | "İrəli çək", VIP, Premium | VIP, yukarı taşı | VIP, VIP+, Super VIP, otomatik yenileme | VIP, Super VIP, renk, "acil" | – |
| Kurumsal | "Biznes" hesap, paketler | Ajans sayfası | Ajans/Developer abonelikleri, proje sayfaları | Ajans abonelikleri | Pro host araçları |
| Günlük kiralama | Sadece ilan (telefonla anlaşma) | Sadece ilan | Sadece ilan | Sadece ilan | **Online rezervasyon + ödeme + yorum** |
| Güven | Moderasyon | Moderasyon | Doğrulanmış ilan rozetleri | "Doğrulanmış" | Kimlik, yorum, ödeme koruması |
| Zayıf yön | Eski UX, sahte/aracı ilanlar, harita zayıf | Az trafik | Karmaşık fiyatlandırma | Kalabalık arayüz | Yerel uzun dönem/satış yok |

**Çıkarımlar**
1. Bölge pazarında para **öne çıkarma (VIP/Premium/yukarı taşı)** ve **ajans abonelikleri**nden kazanılıyor — kanıtlanmış ve kullanıcının alıştığı model.
2. Günlük kiralama (Qəbələ, Quba, Nabran, Bakı sahili, Gudauri, Batumi) yerelde hâlâ **telefonla ve güvensiz ön ödemelerle** yapılıyor → Airbnb tarzı **online rezervasyon + emanetli ödeme + yorum** boşluğu var. Bu bizim farklılaştırıcımız.
3. Sahte ilan ve "sahibi gibi görünen emlakçı" en büyük kullanıcı şikâyeti → **moderasyon, şikâyet sistemi, "Yoxlanılmış" (doğrulanmış) ilan rozeti, "Sahibindən / Agentlik" filtresi**.
4. Harita araması, metro filtresi, mobil uygulama ve hızlı SMS ile giriş (şifresiz) beklenen standartlar.

## 2. Gelir modeli (hibrit)

### A) Freemium ilan
* Bireysel kullanıcı: **30 günde 2 ücretsiz** satış / uzun dönem kira ilanı.
* Kotayı aşınca: **ilan ücreti 3 ₼** (ilan `DRAFT` olarak oluşur, ödeme sonrası moderasyona gider).
* **Günlük kiralama ilanları ücretsiz** — çünkü rezervasyondan komisyon alıyoruz.
* İlan ömrü 30 gün, "Yenilə" ile uzatılır (bayat ilanları temizler, tekrar ödeme fırsatı yaratır).

### B) Öne çıkarma servisleri (à la carte) — gelirin çekirdeği
| Kod | Servis | Süre | Fiyat |
|---|---|---|---|
| `BUMP_1` | Yuxarı qaldır (en üste taşı) | anında | 1 ₼ |
| `AUTO_BUMP_7` | Otomatik her gün yukarı taşı | 7 gün | 5 ₼ |
| `VIP_1/7/30` | VIP blokunda gösterim | 1/7/30 gün | 1.5 / 7 / 20 ₼ |
| `PREMIUM_1/7/30` | Ana sayfa vitrini + aramanın en üstü | 1/7/30 gün | 3 / 15 / 45 ₼ |
| `HIGHLIGHT_7` | Renkli kart | 7 gün | 2 ₼ |
| `URGENT_7` | "Təcili" rozeti | 7 gün | 2 ₼ |
| `VERIFICATION` | Uzman yerinde kontrol → "Yoxlanılıb" rozeti | kalıcı | 15 ₼ |

**Paketler (bundle):** *Sürətli satış* (VIP 7 + Auto-bump 7 + Təcili) **11 ₼** (tekil 14 ₼) · *Maksimum görünmə* (Premium 7 + VIP 7 + Highlight + Auto-bump) **24 ₼** (tekil 29 ₼).

### C) Kurumsal abonelikler (ajans & inşaat şirketleri) — öngörülebilir MRR
| Plan | Aylık | Yıllık (2 ay bedava) | Aktif ilan | Aylık bump | VIP-7 kredisi | Premium-7 kredisi | Temsilci |
|---|---|---|---|---|---|---|---|
| **Start** | 49 ₼ | 490 ₼ | 25 | 30 | – | – | 2 |
| **Pro** | 129 ₼ | 1290 ₼ | 100 | 150 | 5 | 1 | 10 |
| **Enterprise** | 299 ₼ | 2990 ₼ | sınırsız | 600 | 20 | 5 | 50 |

Hepsinde: ajans sayfası, "Biznes" rozeti, istatistikler; Pro+: gelişmiş analitik, lead/CRM, öncelikli moderasyon; Enterprise: XML feed ile toplu ilan, kişisel menajer, developer proje sayfaları.
Abonelikler kayıtlı kartla **otomatik yenilenir** (mock bankada token ile), başarısız olursa `PAST_DUE` → 3 deneme → `EXPIRED`.

### D) Günlük kiralama komisyonu (Airbnb modeli)
* Misafirden **%8 servis ücreti** (fiyatın üstüne), ev sahibinden **%3 komisyon** → işlem başına ~%11 take-rate.
* Para platformda **emanette** tutulur; giriş tarihinden **24 saat sonra** ev sahibinin cüzdanına aktarılır (payout).
* İptal politikası: girişe ≥48 saat kala → %100 iade; daha geç → konaklama bedelinin %50'si iade; ev sahibi iptal ederse → %100 iade.
* Sadece tamamlanmış rezervasyonlar yorum yazabilir → güven döngüsü.

### E) Cüzdan (balans) + yükleme bonusu
* Kartla bakiye yükle, servisleri tek tıkla bakiye ile öde (sürtünmeyi azaltır, nakit akışını öne çeker).
* Bonus: ≥50 ₼ → +%5, ≥100 ₼ → +%10, ≥300 ₼ → +%15 (bonus bakiye önce harcanır, iade edilmez).

### F) Diğer gelirler
* **Banner reklamları** (ana sayfa, arama, ilan detayı) — admin panelinden yönetilir, gösterim/tıklama sayılır (CPM/sabit fiyat B2B satış).
* **İpotek (mortgage) lead'leri** — ilan sayfasında kredi hesaplayıcı + başvuru formu, lead'ler partner bankalara satılır (lead başına ücret).
* (Yol haritası) Developer proje sayfaları, sigorta/taşıma/temizlik partnerlikleri, API/XML ilan beslemesi.

## 3. Neden bu karışım?
* **Paket mi, ilan başı mı?** İkisi birden: bireyler için *ilan başı + öne çıkarma* (düşük giriş bariyeri, pazarın alışık olduğu), profesyoneller için *paket/abonelik* (öngörülebilir gelir, kilitlenme). Günlük kiralamada ise *komisyon* (değer yarattığımız yerden pay).
* Ücretsiz kota arzı (ilan sayısını) büyütür → trafik → öne çıkarma talebi. Ücretli kota spam/aracı ilanı azaltır.
* Tüm fiyatlar admin panelinden değişebilir → A/B test ve kampanya yapılabilir.

## 4. Ölçülecek KPI'lar (admin dashboard'da)
Gelir (bugün / 30 gün / amaç bazında), MRR, aktif abonelik, aktif & bekleyen ilan, yeni kullanıcı, başarılı/başarısız ödeme, rezervasyon GMV, açık şikâyet sayısı.
