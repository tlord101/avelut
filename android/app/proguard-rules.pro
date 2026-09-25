# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# Preserve debugging information for useful crash stack traces in Google Play Console
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-keepattributes *Annotation*
-keepattributes JavascriptInterface
-keepattributes Signature
-keepattributes Exceptions
-keepattributes EnclosingMethod
-keepattributes InnerClasses

# --- Capacitor Core & Bridge Reflection ---
-keep public class com.getcapacitor.** { *; }
-keep class * implements com.getcapacitor.Plugin { *; }
-keepclassmembers class * implements com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public *;
}
-keep class com.getcapacitor.Bridge { *; }
-keep class com.getcapacitor.BridgeActivity { *; }
-keep class com.getcapacitor.PluginConfig { *; }
-keep class com.getcapacitor.annotation.CapacitorPlugin { *; }

# --- WebView JavaScript Interfaces ---
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- App Custom Components ---
-keep class com.avelut.app.MainActivity { *; }
-keep class com.avelut.app.NotificationActionReceiver { *; }

# --- Cordova Compatibility (if plugins use it) ---
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# --- SQLite Plugin ---
-keep class com.getcapacitor.community.database.sqlite.** { *; }
-keep class net.sqlcipher.** { *; }
-keep class net.sqlcipher.database.** { *; }
-dontwarn net.sqlcipher.**

# --- ML Kit & Vision (Text Recognition) ---
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.vision.** { *; }
-keep class com.google.android.gms.tasks.** { *; }
-dontwarn com.google.mlkit.**

# --- Capawesome Plugins & Capgo Updater ---
-keep class io.capawesome.capacitor.** { *; }
-keep class ee.forgr.plugin.capacitor_updater.** { *; }
-dontwarn io.capawesome.capacitor.**
-dontwarn ee.forgr.plugin.capacitor_updater.**

# Suppress generic non-fatal warnings
-dontwarn androidx.**
-dontwarn com.google.errorprone.annotations.**
