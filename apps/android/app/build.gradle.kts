import java.util.Properties

// AGP 9 has built-in Kotlin support: no `org.jetbrains.kotlin.android` plugin is applied.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Firebase Cloud Messaging is optional: drop `app/google-services.json` (from the Firebase console, package
// az.evtap.app) next to this file and the Google Services plugin is applied. Without it the app builds and
// runs; push registration is skipped at runtime (see PushManager).
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun localOrEnv(key: String, default: String = ""): String = localProps.getProperty(key) ?: System.getenv(key) ?: default

android {
    namespace = "az.evtap.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "az.evtap.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Google Maps SDK key: local.properties `MAPS_API_KEY=…` (or env var) → manifest placeholder.
        manifestPlaceholders["mapsApiKey"] = localOrEnv("MAPS_API_KEY")
        // Without a key the Maps SDK cannot load tiles; the app then shows a placeholder instead of the map.
        buildConfigField("boolean", "MAPS_ENABLED", localOrEnv("MAPS_API_KEY").isNotBlank().toString())
        buildConfigField("String", "WEB_URL", "\"${localOrEnv("EVTAP_WEB_URL", "https://evtap.az")}\"")
    }

    signingConfigs {
        // Release signing from local.properties / CI env (never commit the keystore or passwords).
        create("release") {
            val store = localOrEnv("EVTAP_KEYSTORE_FILE")
            if (store.isNotBlank()) {
                storeFile = file(store)
                storePassword = localOrEnv("EVTAP_KEYSTORE_PASSWORD")
                keyAlias = localOrEnv("EVTAP_KEY_ALIAS")
                keyPassword = localOrEnv("EVTAP_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            // Android emulator → host machine. Override for a device on the LAN: EVTAP_API_URL_DEBUG=http://192.168.1.10:4000
            buildConfigField("String", "API_URL", "\"${localOrEnv("EVTAP_API_URL_DEBUG", "http://10.0.2.2:4000")}\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_URL", "\"${localOrEnv("EVTAP_API_URL", "https://api.evtap.az")}\"")
            if (localOrEnv("EVTAP_KEYSTORE_FILE").isNotBlank()) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    androidResources {
        // Per-app language (Settings → Language) — generates locale_config.xml from values-* folders.
        generateLocaleConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/versions/9/OSGI-INF/MANIFEST.MF")
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        optIn.addAll(
            "androidx.compose.material3.ExperimentalMaterial3Api",
            "androidx.compose.foundation.layout.ExperimentalLayoutApi",
            "androidx.compose.foundation.ExperimentalFoundationApi",
        )
    }
}

dependencies {
    implementation(project(":core"))

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.text)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.animation)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.browser)

    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    implementation(libs.play.services.maps)
    implementation(libs.play.services.location)
    implementation(libs.maps.compose)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.tink.android)

    testImplementation(libs.junit)
    testImplementation(libs.kotlin.test)
}
