package android.util;

public final class Log {
    public static int e(String tag, String msg, Throwable t) { System.err.println(tag + ": " + msg); if (t != null) t.printStackTrace(); return 0; }
    public static int e(String tag, String msg) { return e(tag, msg, null); }
    public static int w(String tag, String msg) { return 0; }
    public static int w(String tag, String msg, Throwable t) { return 0; }
    public static int d(String tag, String msg) { return 0; }
    public static int i(String tag, String msg) { return 0; }
    public static int v(String tag, String msg) { return 0; }
}
