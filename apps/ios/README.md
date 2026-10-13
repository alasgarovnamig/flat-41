# EvTap iOS

Native iOS client for EvTap (sale, monthly rent, daily rent with booking, promotions, wallet, business plans).
Swift 6 + SwiftUI, iOS 17+, styled with the **Soft Monochrome** design system (`docs/design/DESIGN_SYSTEM.md`).

## Setup

```sh
brew install xcodegen
cd apps/ios
xcodegen            # or: make project
open EvTap.xcodeproj
```

`EvTap.xcodeproj` is generated from `project.yml` and is git-ignored — re-run `xcodegen` after adding or removing files.
Xcode 16+ is required (Swift 6 language mode).

### Signing

Set your team once in Xcode (Signing & Capabilities) or in `Config/Base.xcconfig` (`DEVELOPMENT_TEAM = XXXXXXXXXX`).
Bundle id is `az.evtap.app`. The target uses the Push Notifications and Associated Domains capabilities, so the
App ID must have both enabled in the Apple Developer portal.

### API endpoint

| Configuration | `API_BASE_URL`             | Info.plist                  |
|---------------|----------------------------|-----------------------------|
| Debug         | `http://localhost:4000`    | `Supporting/Info-Debug.plist` (ATS exception for localhost only) |
| Release       | `https://api.evtap.az`     | `Supporting/Info.plist`     |

Values live in `Config/Debug.xcconfig` / `Config/Release.xcconfig` (`//` is written as `/$()/` because xcconfig
treats `//` as a comment). To test against a backend on your Mac from a physical device, change the Debug value to
your Mac's LAN address.

### Push notifications

`AppDelegate` registers for remote notifications and hands the APNs device token to `PushManager`, which posts it to
`POST /users/me/push-tokens` (`platform: "ios"`; removed with `DELETE` on logout / opt-out). `aps-environment` is `development` for Debug and `production` for Release
(`APS_ENVIRONMENT` in the xcconfigs). **Server-side gap:** the backend currently delivers pushes through Expo's push
service; native APNs tokens need an APNs provider (token-based `.p8` key) on the server before pushes arrive.
Notification taps are routed through `DeepLink.from(notificationData:)`.

### Universal links / deep links

- Custom scheme: `evtap://listing/<id>`, `evtap://payment/result?paymentId=…&status=…` (payment return URL), plus
  `evtap://booking/<id>`, `evtap://messages/<id>`, `evtap://page/<slug>`, `evtap://search?…`, `evtap://wallet`,
  `evtap://notifications`; the same paths work on `https://evtap.az` (optionally `/ru/…`, `/en/…`) — see `Packages/EvTapCore/Sources/EvTapCore/Routing/DeepLink.swift`.
- Universal links: `applinks:evtap.az` is in the entitlements; the web needs to serve
  `https://evtap.az/.well-known/apple-app-site-association` listing `<TEAMID>.az.evtap.app`.

## Structure

```
apps/ios
├── project.yml                  XcodeGen spec (target EvTap, scheme incl. EvTapCore tests)
├── Makefile                     bootstrap / project / build / test / test-core / check-strings
├── Config/                      Base, Debug, Release xcconfigs
├── Supporting/                  Info.plist, Info-Debug.plist, EvTap.entitlements
├── Packages/EvTapCore/          Platform-neutral core (Foundation only, builds on Linux)
│   ├── Sources/EvTapCore/
│   │   ├── Models/              Codable models mirroring packages/shared (contract v2)
│   │   ├── Networking/          APIClient (bearer, single-flight refresh, typed APIError), Endpoints, multipart
│   │   ├── Auth/                AuthStore (Keychain / in-memory), TokenManager actor
│   │   ├── Realtime/            RealtimeClient (URLSessionWebSocketTask, back-off, ping/pong, typing)
│   │   ├── Formatting/ Pricing/ Locations/ Validation/ Search/ Routing/ Localization/
│   └── Tests/EvTapCoreTests/    XCTest: formatting, pricing, decoding, API client, filters, deep links, …
├── EvTap/
│   ├── App/                     @main, RootView (tabs + glass tab bar), Router, stores, localization
│   ├── DesignSystem/            EvTapTokens.swift (generated tokens), Theme, Components/
│   ├── Services/                RealtimeHub, PaymentCoordinator, PushManager, media/location helpers
│   ├── Features/                One folder per feature: View + @Observable view model
│   └── Resources/               Fonts (Outfit, Inter + OFL), Localizable.xcstrings, locations.json, Assets
└── scripts/                     gen-locations.mjs, check-strings.mjs
```

### Features

Home (stats strip, featured, banners) · Search (filters sheet, sort, saved searches, map with clustered price pills)
· Listing detail (gallery, facts, amenities, map, mortgage calculator, reviews, report, contact/phone reveal)
· Booking flow (calendar availability, quote, book, pay, resume payment, cancel, review) · Auth (phone OTP, email)
· Post-listing wizard (6 steps, PhotosPicker + camera, downscale ≤1600 px, map pin, edit mode) · Promote
· Payments (card/wallet, `ASWebAuthenticationSession` bank page, result polling + realtime) · Wallet & top-up bonuses
· Payment history · My listings (+ stats chart) · Bookings (guest/host) · Host calendar (block/unblock)
· Messages (realtime, typing, read receipts) · Notifications · Favorites · Saved searches · Business plans
· Agency profile (+30-day stats) · Profile / settings (language, theme, push, delete account) · CMS pages.

### Design system mapping

Tokens come from `EvTap/DesignSystem/EvTapTokens.swift` (generated from the shared token source, do not edit).
Components map 1:1 to the design doc: `AppBackground` (grey canvas), `Card`/`StatCard` (28 pt frosted),
`BarcodeSpark`, `SplitMeter` (hatched), `PillBarChart` ("+10%" tags), `PropertyCard` (white fade, heart + ↗),
`GlassTabBar` (floating capsule + black post button), `IconButton` (44 pt circles), `FilterPill`, `PillTabs`,
`Segmented`, `SearchField`, `Badge`, `EmptyState`, `Skeleton`, `PrimaryButton`, `EvTextField`. Map uses
`.mapStyle(.standard(emphasis: .muted, pointsOfInterest: .excludingAll))` with black price pills.

### Localization

`Resources/Localizable.xcstrings` holds az (development language), ru and en. The language can be switched in-app
(Settings) independently of the system language; `Localizer` loads the matching `.lproj` bundle and `L("key", [...])`
interpolates `{name}` placeholders. `make check-strings` verifies that every key used in Swift exists in all three
languages.

### Accessibility

Fonts scale with Dynamic Type (`Font.ev(_:)` uses `relativeTo:`), interactive elements are ≥ 44 pt, icon-only
buttons carry VoiceOver labels, animations honour Reduce Motion, and all colours have dark-mode variants.

## Tests

```sh
swift test --package-path Packages/EvTapCore   # or: make test-core (also runs on Linux)
make test                                       # xcodebuild test on an iOS simulator
```

## Verification status

This app was written in an environment without macOS/Xcode. What was checked:

- every `.swift` file parses with tree-sitter-swift (no ERROR/MISSING nodes);
- memberwise-initialiser call sites checked by a static script (labels, order, required params);
- all localization keys referenced in code exist in az/ru/en;
- `project.yml` keys validated against the XcodeGen spec; plists and the string catalog validated as plist/JSON.

Not yet done: compiling with Xcode/Swift 6, running the XCTest suite, running on a simulator/device. Expect a
round of small compiler fixes on first build.

## Fonts

Outfit and Inter (static instances, from google/fonts) are bundled under `EvTap/Resources/Fonts` with their SIL Open
Font License files. If a font fails to load, the UI falls back to the system font.
