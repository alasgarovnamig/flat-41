// :core — pure Kotlin/JVM (no Android dependencies): DTOs, the Retrofit API contract, error mapping,
// pricing / formatting / locations / validation / search-filter logic. Unit-tested on the plain JVM.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

dependencies {
    api(libs.kotlinx.coroutines.core)
    api(libs.kotlinx.serialization.json)
    api(libs.okhttp)
    api(libs.retrofit)
    api(libs.retrofit.kotlinx.serialization)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test {
    // Tests read the bundled locations asset of :app (single JSON shared by both modules).
    systemProperty("evtap.locationsJson", project.file("../app/src/main/assets/locations.json").absolutePath)
}
