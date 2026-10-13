# @evtap/mobile — EvTap iOS + Android

Expo SDK 57 · React Native 0.86 · expo-router · TanStack Query · socket.io · az / ru / en.

```bash
pnpm install && pnpm build:shared          # repo root
cp apps/mobile/.env.example apps/mobile/.env
pnpm --filter @evtap/mobile start          # Metro on :8081
pnpm --filter @evtap/mobile typecheck
npx expo export --platform android|ios     # bundle check (run inside apps/mobile)
```

Native modules (maps, secure-store, notifications…) need a **development build** (`eas build --profile development`
or `npx expo run:ios|android`); `ios/` and `android/` are generated (CNG) and git-ignored.

## Configuration (`app.config.ts`)

| Env | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | API origin without `/api/v1`. iOS simulator `http://localhost:4000`, **Android emulator `http://10.0.2.2:4000`**, device `http://<LAN-IP>:4000` |
| `EXPO_PUBLIC_WEB_URL` | Website used for share links (`https://evtap.az/listing/<id>`) |
| `GOOGLE_MAPS_ANDROID_API_KEY` | **Required on Android** (Google Maps SDK for Android, restrict to package `az.evtap.app` + SHA-1). Wired via `android.config.googleMaps.apiKey` and the `react-native-maps` plugin |
| `GOOGLE_MAPS_IOS_API_KEY` | Optional — iOS uses Apple Maps (no key) unless set |
| `EAS_PROJECT_ID` | `eas init` project id — required by `getExpoPushTokenAsync` |
| `APP_VARIANT` | `development` / `preview` / `production` (set by `eas.json`; dev/preview get `.dev`/`.preview` bundle-id suffixes) |

* Scheme `evtap://` (e.g. `evtap://listing/<id>`, `evtap://payment/result?paymentId=…&status=…`).
  Universal / app links for `evtap.az` are declared (placeholder) — host `apple-app-site-association` and `assetlinks.json`.
* Icons/splash are generated placeholders: `pnpm --filter @evtap/mobile assets` (sharp).

## How things work

* **API client** `src/api/client.ts` — one typed function per endpoint of `packages/shared/src/api.ts`; tokens in
  expo-secure-store; on 401 a single-flight `POST /auth/refresh` then one retry; refresh failure → logout.
  Uploads use XHR (progress) after resizing to ≤1600px JPEG with expo-image-manipulator.
* **Card payments** `src/payments/pay.ts` — `POST /checkout` with `returnUrl = evtap://payment/result` →
  `WebBrowser.openAuthSessionAsync(paymentUrl, returnUrl)` → `/payment/result` polls `GET /payments/:id` until final.
  `app/+native-intent.tsx` drops the duplicate Android deep link while the auth session is open.
* **Realtime** `src/realtime/socket.tsx` — socket.io `path: /ws`, `auth.token` (re-read on every reconnect);
  updates message / conversation / notification / payment caches.
* **Push** `src/push/*` — Expo push token → `POST /users/me/push-tokens` after login (toggle in Settings →
  `DELETE …/push-tokens/:token`). Taps route by `data.url | conversationId | paymentId | bookingId | listingId`.
  Android: upload FCM v1 credentials with `eas credentials`; iOS: EAS provisions the APNs key.
* **i18n** `src/i18n` — typed dictionaries (az is the source of truth; ru/en must match its shape).
* **Maps** `src/components/map/Maps.tsx` (react-native-maps) with a `.web.tsx` fallback for web previews.

## Store checklist

* Account deletion in-app (Settings → Delete account → `DELETE /users/me`) — App Store 5.1.1(v).
* Permission strings: camera, photo library, location-when-in-use (English, in `app.config.ts`); no background location,
  microphone blocked on Android.
* `ITSAppUsesNonExemptEncryption: false`; replace `ascAppId` in `eas.json` before `eas submit`.
