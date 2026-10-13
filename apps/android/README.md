# EvTap for Android

This is the native Android client for EvTap, written in Kotlin with Jetpack Compose and Material 3. It replaces the
old React Native app.

| | |
|---|---|
| applicationId | `az.evtap.app` (debug: `az.evtap.app.debug`) |
| minSdk / target / compile | 26 / 36 / 36 |
| Toolchain | AGP 9.3 (built-in Kotlin) · Kotlin 2.4 + Compose compiler plugin · Gradle 9.8 wrapper · JDK 17+ |
| UI | Compose BOM 2026.09, Material 3 + custom `EvTapTheme` (see `docs/design/DESIGN_SYSTEM.md`) |

## Modules

- **`:core`** is pure Kotlin/JVM with no Android dependencies, so it is unit-tested with `./gradlew :core:test`. It holds:
  - the API contract: DTOs, request bodies and the Retrofit `EvTapApi`, mirroring `packages/shared/src/{api,types,schemas}.ts`
  - error-code mapping
  - formatting and pricing, ported from `format.ts` and `pricing.ts`
  - locations lookups
  - search filters and query building
  - map clustering
  - listing-draft validation
  - deep-link parsing
  - the realtime protocol, backoff and booking-calendar logic
  - a small Markdown parser
- **`:app`** is the Android app. It uses:
  - manual DI (`AppContainer`) and Retrofit, OkHttp and kotlinx.serialization
  - Coil 3 for images
  - type-safe Navigation Compose routes (`ui/navigation/Routes.kt`)
  - DataStore with Tink AEAD for tokens, keyed by an Android Keystore master key
  - Maps Compose, fused location, the Photo Picker and TakePicture
  - Custom Tabs for checkout, and FCM for push

Generated or copied inputs (don't edit them by hand):

| File | Source | Regenerate with (from `apps/android`) |
|---|---|---|
| `app/src/main/java/az/evtap/app/ui/theme/EvTapTokens.kt` | `packages/design-tokens/dist/EvTapTokens.kt` | copy it unchanged |
| `app/src/main/assets/locations.json` | `packages/shared/src/locations.ts` | `node --experimental-strip-types tools/export-locations.mjs` |
| `app/src/main/java/az/evtap/app/ui/icons/EvIcons.kt` | Lucide 1.56.0 (ISC) | `npm pack lucide-static@1.56.0 && tar xzf lucide-static-1.56.0.tgz && node tools/gen-icons.mjs package/icon-nodes.json` |
| `app/src/main/res/font/{outfit,inter}.ttf` | Outfit and Inter variable fonts (OFL) | licences are in `app/src/main/assets/licenses/` |

## Getting started

1. Install the latest stable **Android Studio** (it ships JDK 21; any JDK 17+ works). Open the `apps/android` folder,
   not the repository root.
2. Studio creates `local.properties` with `sdk.dir`. Add the optional values you need:

   ```properties
   # Google Maps SDK for Android key (Maps SDK enabled; restrict it to package az.evtap.app(.debug) + your SHA-1)
   MAPS_API_KEY=AIza...
   # API for debug builds. Default: http://10.0.2.2:4000 (the host machine from the Android emulator).
   # For a physical device on the LAN: EVTAP_API_URL_DEBUG=http://192.168.1.10:4000
   # EVTAP_API_URL_DEBUG=http://10.0.2.2:4000
   # Release API (default https://api.evtap.az) and the web origin used for share links
   # EVTAP_API_URL=https://api.evtap.az
   # EVTAP_WEB_URL=https://evtap.az
   ```

   Any of these can also come from environment variables, which is useful on CI. Without `MAPS_API_KEY` the app runs,
   but map views show a placeholder.
3. Start the API (`apps/api`) on port 4000, then run the **app** configuration (debug). Debug builds allow cleartext
   HTTP and user CAs **only** through `src/debug/res/xml/network_security_config.xml`. Release builds are HTTPS-only.
   In debug, the OTP screen shows the dev code when the API returns one.

Command line:

```bash
./gradlew :core:test              # JVM unit tests (contract, pricing, filters, deep links, realtime, …)
./gradlew :app:assembleDebug      # debug APK
./gradlew :app:bundleRelease      # signed release AAB (see Signing)
./gradlew :app:lintDebug
```

## Push notifications (FCM)

`google-services.json` is **not committed**. To enable push:

1. Create a Firebase project and add the Android apps `az.evtap.app` and `az.evtap.app.debug`.
2. Download `google-services.json` into `apps/android/app/`. The Google Services plugin applies itself only when that
   file exists, so builds without it still work and simply skip push registration at runtime.
3. Backend: set `PUSH_PROVIDER=native` and `FCM_SERVICE_ACCOUNT_JSON` (a service-account key for the same Firebase
   project) in `apps/api`. After login the app registers its token with
   `POST /users/me/push-tokens {token, platform:"android"}` and removes it on logout.

Notifications use the `general` channel. Tapping one opens the deep link from the message `data`
(`url`, `conversationId`, `paymentId`, `bookingId` or `listingId`). With only `notificationId`, it opens the
notifications screen. On Android 13+ the app asks for
`POST_NOTIFICATIONS` after login. The user can also turn push off in Settings.

## Signing (release)

Never commit keystores or passwords. Put these values in `local.properties` or the CI environment:

```properties
EVTAP_KEYSTORE_FILE=/absolute/path/evtap-release.jks
EVTAP_KEYSTORE_PASSWORD=...
EVTAP_KEY_ALIAS=evtap
EVTAP_KEY_PASSWORD=...
```

Without them, `assembleRelease` produces an unsigned APK. Release builds use R8 (minify + shrink resources) with
`app/proguard-rules.pro`. Keep `app/build/outputs/mapping/release/mapping.txt` for every release you ship.
If you use Play App Signing, upload the AAB signed with the upload key.

**App Links:** `https://evtap.az/{az,ru,en}/listings/…` and `/…/search` open in the app (`autoVerify`). Serve
`https://evtap.az/.well-known/assetlinks.json` with the release (or Play App Signing) SHA-256 for `az.evtap.app`.
Custom-scheme links (`evtap://listing/<id>`, `evtap://payment/result?...`) need no setup.

## Payments

Checkout (`POST /checkout`) returns `redirectUrl`, `paymentId` and `returnUrl = evtap://payment/result`. The flow:

1. The app first navigates to the payment-result screen, then opens the bank page in a **Custom Tab**.
2. The bank redirects to `evtap://payment/result?paymentId=…`. `MainActivity` (singleTask) receives it.
3. The result screen polls `GET /payments/:id` every 2 s for up to 90 s, and also listens for the realtime
   `payment:updated` event.

Wallet payments complete instantly and don't open a browser.

## Implementation notes

- **Money:** listing `price` / `pricePerM2` are in **major** units (₼). All other amounts (wallet, payments,
  services, bookings) are in **minor** units (qəpik). See `core/format/Format.kt`.
- **Realtime:** a plain WebSocket at `/ws?token=<access>` with `{event,data}` frames. The server sends a ping every
  25 s and the client answers with a pong. Close code 4401 makes the client refresh the token and reconnect;
  otherwise it backs off from 1 s up to 30 s. It connects only while the app is in the foreground.
- **Tokens:** `TokenStore` encrypts the access and refresh tokens with Tink AEAD in DataStore. A single-flight
  OkHttp `Authenticator` refreshes them on 401. Backups are disabled (`allowBackup=false`, data-extraction rules)
  because the tokens are bound to the device key.
- **Fonts:** Outfit has no `ə`, `₼` or Cyrillic glyphs. On API 29+, display text uses a `CustomFallbackBuilder`
  chain of Outfit → Inter → sans-serif. On API 26–28 the system font supplies the missing glyphs.
- **Languages:** az (default), ru and en, using `AppCompatDelegate.setApplicationLocales` and the generated
  `locale_config`. API requests send `Accept-Language`.
- **Accessibility:**
  - every icon button has a label and a touch target of at least 48 dp
  - text sizes are in `sp`
  - animation scale 0 (reduced motion) turns off transitions, crossfades and press scaling
  - dark theme follows the system or Settings
