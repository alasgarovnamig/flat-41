# EvTap release (R8 full mode, AGP default).
#
# Most libraries ship their own consumer rules inside the AAR/JAR (Retrofit 3, OkHttp 5, kotlinx.serialization,
# Coroutines, Coil 3, Navigation, Firebase, Play services, Tink). The rules below only cover what is specific to
# this app, plus a few belt-and-braces keeps for reflection-adjacent code paths.

# ── kotlinx.serialization ────────────────────────────────────────────────────────────────────────────────────
# DTOs (az.evtap.core.model), request bodies, search filters and the typed Navigation routes
# (az.evtap.app.ui.navigation.*Route) are all @Serializable. The library's bundled rules keep generated
# serializers for classes that are referenced statically; keep the companion `serializer()` lookups explicitly
# because Navigation resolves route serializers via `serializer<T>()` / KType at runtime.
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions, EnclosingMethod, RuntimeVisibleAnnotations, AnnotationDefault
-dontnote kotlinx.serialization.**

-keepclassmembers @kotlinx.serialization.Serializable class az.evtap.** {
    static ** Companion;
    *** Companion;
    static ** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class az.evtap.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class az.evtap.**$$serializer { *; }
# Enum wire names come from @SerialName; keep enum constants used by serializers.
-keepclassmembers enum az.evtap.** {
    <fields>;
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── Retrofit ─────────────────────────────────────────────────────────────────────────────────────────────────
# Retrofit creates a dynamic proxy for the service interface; keep its methods and their generic signatures
# (suspend functions are compiled to methods taking kotlin.coroutines.Continuation).
-keep,allowobfuscation interface az.evtap.core.api.EvTapApi
-keepclassmembers,allowshrinking,allowobfuscation interface az.evtap.core.api.EvTapApi {
    @retrofit2.http.* <methods>;
}
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-keep,allowobfuscation,allowshrinking class retrofit2.Response

# ── OkHttp / Okio ────────────────────────────────────────────────────────────────────────────────────────────
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ── Tink (token encryption) ──────────────────────────────────────────────────────────────────────────────────
# Tink uses protobuf-lite internally; its generated messages are accessed reflectively by GeneratedMessageLite.
-keepclassmembers class * extends com.google.crypto.tink.shaded.protobuf.GeneratedMessageLite {
    <fields>;
}
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn com.google.api.client.http.**
-dontwarn org.joda.time.**

# ── Firebase Messaging ───────────────────────────────────────────────────────────────────────────────────────
# The service is referenced from the manifest (kept automatically by AAPT rules); nothing extra required.

# Keep line numbers for readable crash reports (upload the mapping.txt with each release).
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
