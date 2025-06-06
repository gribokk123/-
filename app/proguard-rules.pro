# Сохранить WebView JavaScript интерфейс
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Сохранить классы WebView
-keep class android.webkit.** { *; }

# Оптимизация для игры
-keep class com.mafiagame.app.** { *; }

# Удалить логи в release
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}
