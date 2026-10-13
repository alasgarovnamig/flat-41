# EvTap — Daşınmaz əmlak platforması 🏠

Azerbaycan pazarı için emlak ilan platformu: **satış, aylık kira ve Airbnb tarzı online rezervasyonlu günlük kira**.
bina.az / ev10.az (AZ), myhome.ge / home.ss.ge (GE) ve Airbnb analiz edilerek tasarlandı.

| Parça | Teknoloji | Klasör | Port |
|---|---|---|---|
| Backend API | NestJS 11, PostgreSQL, Drizzle ORM, socket.io | `apps/api` | 4000 |
| Kullanıcı web sitesi | Next.js 16 (SSR/SEO), Tailwind, Leaflet | `apps/web` | 3000 |
| Admin paneli | Vite + React 19, TanStack Query, Recharts | `apps/admin` | 3001 |
| iOS + Android uygulaması | Expo (React Native), expo-router | `apps/mobile` | 8081 |
| Mock banka (ödeme ağ geçidi) | Express + PostgreSQL | `apps/mockbank` | 4100 |
| Ortak sözleşme | TypeScript tipleri, zod şemaları, fiyat kataloğu | `packages/shared` | – |

📄 Belgeler: [Mimari](docs/ARCHITECTURE.md) · [Pazar analizi ve gelir modeli](docs/BUSINESS_MODEL.md) · [Mock banka sözleşmesi](docs/MOCKBANK.md) · [Mobil uygulama](apps/mobile/README.md)

---

## 🚀 Hızlı başlangıç (Docker)

```bash
docker compose up --build -d
docker compose exec api node dist/db/seed.js     # demo veriler (63 ilan, ajanslar, kullanıcılar)
```

| Adres | |
|---|---|
| http://localhost:3000 | Web sitesi |
| http://localhost:3001 | Admin paneli — `admin@evtap.az` / `Admin12345!` (moderatör: `moderator@evtap.az` / `Moder12345!`) |
| http://localhost:4000/api/docs | Swagger API belgeleri |
| http://localhost:4100/admin | Mock banka yönetimi — `admin` / `admin` |

Giriş: herhangi bir telefon numarası + SMS kodu **`111111`** (geliştirme modu). Demo kullanıcıların şifresi `Demo12345!`.

## 💻 Geliştirme ortamı (Docker'sız)

Gereksinimler: Node 22+, pnpm 10, PostgreSQL 16.

```bash
pnpm install
pnpm build:shared                                   # ortak paketi derle (değiştirdikçe tekrar)

# Veritabanları
createdb evtap && createdb mockbank                 # kullanıcı/şifre: evtap/evtap (bkz. .env.example)

# API
cp apps/api/.env.example apps/api/.env
pnpm --filter @evtap/api db:migrate                 # veya geliştirirken: db:push
pnpm --filter @evtap/api db:seed                    # SEED_IMAGES=local → internetsiz demo fotoğraflar
pnpm dev:api                                        # :4000

pnpm dev:mockbank                                   # :4100
pnpm dev:web                                        # :3000
pnpm dev:admin                                      # :3001  (API'siz deneme: pnpm --filter @evtap/admin dev:mock)
pnpm dev:mobile                                     # Expo; Android emülatörde EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
```

Testler ve kontroller:

```bash
pnpm -r typecheck
pnpm --filter @evtap/mockbank test                  # 38 test
pnpm --filter @evtap/api test                       # 37 test (canlı testler için API çalışıyor olmalı: API_URL=http://localhost:4000)
```

## ✨ Özellikler

**Kullanıcı (web + mobil)**
- SMS kodu ile şifresiz giriş (+ e-posta/şifre), az / ru / en dilleri
- Gelişmiş arama: şehir → rayon / metro, fiyat, alan, oda, kat, tamir, çıxarış (kupça), ipotek, olanaklar, sahibi/ajans, fotoğraflı, doğrulanmış; günlük kirada tarih + misafir müsaitliği; **harita araması**; kayıtlı arama + yeni ilan bildirimi
- İlan detayı: galeri, telefon göster (sayılır), mesaj, favori, paylaş, şikâyet, benzer ilanlar, **ipotek hesaplayıcı + banka başvurusu**
- 6 adımlı ilan verme sihirbazı (harita pini, foto yükleme/sıralama), ilan yönetimi (satıldı, arşiv, yenile, istatistik)
- **Günlük kira rezervasyonu**: müsaitlik takvimi, anlık fiyat teklifi, kart/cüzdan ödemesi, iptal politikası, yorum + ev sahibi cevabı, ev sahibi takvimi
- Gerçek zamanlı mesajlaşma (socket.io, "yazıyor…", okundu), bildirimler + mobil push (Expo)
- Cüzdan (bonuslu yükleme), ödeme geçmişi, öne çıkarma, kurumsal abonelik, ajans sayfası / temsilciler / istatistik, hesap silme

**Admin paneli**
- Dashboard: gelir, MRR, kullanıcı, ilan, rezervasyon, ödeme başarı oranı grafikleri
- Klavye ile hızlı **moderasyon kuyruğu** (A onay, R red + hazır sebepler, B blokla)
- İlan / kullanıcı / ajans / ödeme (iade) / rezervasyon / abonelik / şikâyet yönetimi
- **Fiyatlar, paketler ve platform ayarları kod değiştirmeden düzenlenir**
- Banner, CMS sayfaları, ipotek lead'leri, toplu bildirim, audit log; ADMIN / MODERATOR rolleri

**Backend**
- JWT (15 dk) + dönen refresh token (30 gün, yeniden kullanım tespiti), rol koruması, rate limit
- Cron işleri: ilan süresi, öne çıkarma bitişi, otomatik yukarı taşıma, rezervasyon tutma süresi, ev sahibine ödeme (payout), abonelik yenileme, kayıtlı arama eşleşmesi, ödeme mutabakatı
- Yerel / S3 uyumlu dosya depolama (sharp ile webp + küçük resim)

## 💰 Gelir modeli (özet)

Hibrit model — detaylar ve rakip analizi: [docs/BUSINESS_MODEL.md](docs/BUSINESS_MODEL.md)

1. **Freemium ilan:** bireyler 30 günde 2 ücretsiz ilan, sonrası 3 ₼/ilan (günlük kira ilanları ücretsiz)
2. **Öne çıkarma:** Yukarı qaldır 1 ₼, VIP 1.5–20 ₼, Premium 3–45 ₼, renkli kart, "Təcili", doğrulanmış rozeti 15 ₼, indirimli paketler
3. **Kurumsal abonelik:** Start 49 ₼ / Pro 129 ₼ / Enterprise 299 ₼ aylık (yıllıkta 2 ay bedava), kayıtlı kartla otomatik yenileme
4. **Günlük kira komisyonu:** misafirden %8 servis ücreti + ev sahibinden %3; para emanette, girişten 24 saat sonra ev sahibine
5. **Cüzdan bonusu**, banner reklamları, ipotek lead satışı

## 💳 Ödeme (mock banka)

Tüm ödemeler `PaymentProvider` arayüzünden geçer; şu an `MockBankProvider` aktif. Akış gerçek bir Azerbaycan bankası gibidir:
banka ödeme sayfası → 3-D Secure (kod `111111`) → imzalı webhook (HMAC-SHA256) → kullanıcıya geri yönlendirme. İade, kısmi iade, kayıtlı kart (abonelik yenileme) desteklenir.

| Test kartı | Sonuç |
|---|---|
| `4111 1111 1111 1111` | Onay (3DS yok) |
| `5555 5555 5555 4444` | 3DS → onay |
| `4000 0000 0000 0002` | Red — DO_NOT_HONOR |
| `4000 0000 0000 9995` | Red — yetersiz bakiye |

**Gerçek bankaya geçiş:** `apps/api/src/modules/payments/providers/` içinde yeni bir sağlayıcı sınıfı yazıp `providers/index.ts`'e ekleyin ve `PAYMENT_PROVIDER` env değerini değiştirin. Başka hiçbir kod değişmez.

## 📱 Mobil uygulama yayını

Ayrıntılar `apps/mobile/README.md`'de. Özet: `eas build` ile development/preview/production profilleri; Android için Google Maps anahtarı (`GOOGLE_MAPS_ANDROID_API_KEY`), push için `EAS_PROJECT_ID` + FCM/APNs kimlik bilgileri; App Store gönderimi için `eas.json` içindeki `ascAppId`.

## 🗺️ Yol haritası / bilinen eksikler

- Gerçek SMS (LSIM vb.), e-posta ve ödeme sağlayıcısı entegrasyonu (arayüzler hazır)
- Doğrulama hizmeti şu an ödeme anında rozeti veriyor; saha ziyareti iş akışı eklenecek
- GEL rezervasyonlarında kur dönüşümü (cüzdan AZN)
- Cron işleri tek sunucu için; yatay ölçeklemede dağıtık kilit (advisory lock) gerekir
- Gerçek ikon / splash / marka görselleri, mağaza metinleri
- Admin'de bazı uç noktalar sunucu tarafı sıralama desteklemiyor (sayfa içi sıralama)
