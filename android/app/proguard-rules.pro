-keep class org.bouncycastle.math.ec.rfc7748.** { *; }
-dontwarn org.bouncycastle.**

# ML Kit finds its registrars and components by reflection; R8 full mode
# strips them and BarcodeScanning.getClient throws an NPE.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_barcode** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_common.** { *; }
