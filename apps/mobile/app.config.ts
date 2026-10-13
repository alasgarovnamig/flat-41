import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * EvTap — Expo app config (Continuous Native Generation: `ios/` and `android/` are generated
 * by `expo prebuild` / EAS Build and are NOT committed).
 *
 * Environment variables (put them in `apps/mobile/.env` or EAS secrets):
 *  - EXPO_PUBLIC_API_URL            API origin WITHOUT `/api/v1`. Default http://localhost:4000.
 *                                   iOS simulator: http://localhost:4000 · Android emulator: http://10.0.2.2:4000
 *                                   · physical device: http://<your-LAN-IP>:4000
 *  - EXPO_PUBLIC_WEB_URL            Public website used for share links. Default https://evtap.az
 *  - GOOGLE_MAPS_ANDROID_API_KEY    Google Maps SDK for Android key (required for maps on Android release builds).
 *  - GOOGLE_MAPS_IOS_API_KEY        Optional. When set, iOS uses Google Maps instead of Apple Maps (we default to Apple Maps).
 *  - EAS_PROJECT_ID                 EAS project id — needed for Expo push tokens (`getExpoPushTokenAsync`).
 *  - APP_VARIANT                    development | preview | production (set by eas.json profiles).
 */
const IS_DEV = process.env.APP_VARIANT === 'development';
const IS_PREVIEW = process.env.APP_VARIANT === 'preview';

const BRAND = '#0E7C66';
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const webUrl = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://evtap.az';

const bundleId = IS_DEV ? 'az.evtap.app.dev' : IS_PREVIEW ? 'az.evtap.app.preview' : 'az.evtap.app';
const appName = IS_DEV ? 'EvTap (Dev)' : IS_PREVIEW ? 'EvTap (Preview)' : 'EvTap';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: appName,
  slug: 'evtap',
  scheme: 'evtap', // evtap://listing/<id>, evtap://payment/result?paymentId=..&status=..
  version: '1.0.0',
  runtimeVersion: { policy: 'appVersion' },
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic', // light + dark mode
  ios: {
    bundleIdentifier: bundleId,
    buildNumber: '1',
    supportsTablet: false,
    // Universal links (placeholder): host https://evtap.az/.well-known/apple-app-site-association
    // with appID "<TEAMID>.az.evtap.app" and paths ["/listing/*", "/payment/result*"].
    associatedDomains: ['applinks:evtap.az'],
    infoPlist: {
      // Camera: taking listing photos in the "Post listing" wizard and avatar.
      NSCameraUsageDescription: 'EvTap uses the camera so you can take photos of your property for your listing.',
      // Photo library: picking listing photos and profile avatar.
      NSPhotoLibraryUsageDescription: 'EvTap needs access to your photos so you can add pictures to your listing.',
      // Location (when in use): "Near me" on the map and pinning your property location.
      NSLocationWhenInUseUsageDescription: 'EvTap uses your location to show listings near you and to pin your property on the map.',
      LSApplicationQueriesSchemes: ['whatsapp', 'tel'],
    },
    config: {
      usesNonExemptEncryption: false,
      ...(process.env.GOOGLE_MAPS_IOS_API_KEY ? { googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY } : {}),
    },
  },
  android: {
    package: bundleId,
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      monochromeImage: './assets/images/monochrome-icon.png',
      backgroundColor: BRAND,
    },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.POST_NOTIFICATIONS',
    ],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.ACCESS_BACKGROUND_LOCATION'],
    config: {
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY },
    },
    // App links (placeholder): https://evtap.az/.well-known/assetlinks.json with the release SHA-256.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: 'evtap.az', pathPrefix: '/listing' },
          { scheme: 'https', host: 'evtap.az', pathPrefix: '/payment/result' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',
        dark: { image: './assets/images/splash-icon.png', backgroundColor: '#0B0F0E' },
      },
    ],
    'expo-secure-store',
    'expo-localization',
    'expo-web-browser',
    [
      'expo-image-picker',
      {
        photosPermission: 'EvTap needs access to your photos so you can add pictures to your listing.',
        cameraPermission: 'EvTap uses the camera so you can take photos of your property for your listing.',
        microphonePermission: false,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'EvTap uses your location to show listings near you and to pin your property on the map.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: BRAND,
        defaultChannel: 'default',
      },
    ],
    [
      // Apple Maps on iOS (no key), Google Maps on Android (key from GOOGLE_MAPS_ANDROID_API_KEY).
      'react-native-maps',
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    apiUrl,
    webUrl,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
    router: {},
  },
  owner: process.env.EXPO_OWNER,
});
