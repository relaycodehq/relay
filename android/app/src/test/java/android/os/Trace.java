package android.os;

public final class Trace {
    public static void beginSection(String name) {}
    public static void endSection() {}
    public static boolean isEnabled() { return false; }
    public static void beginAsyncSection(String name, int cookie) {}
    public static void endAsyncSection(String name, int cookie) {}
    public static void setCounter(String name, long value) {}
}
