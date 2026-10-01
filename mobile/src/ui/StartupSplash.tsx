import { useEffect, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
  useAnimatedValue,
} from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useReducedMotion } from "react-native-reanimated";
import { useRemote } from "../remote/RemoteProvider";
import { useForeground } from "./motion";
import { useTheme } from "./theme";

// Hold the native mark until its identical React Native image has loaded.
void SplashScreen.preventAutoHideAsync();
const logo = require("../../assets/splash-icon.png");
const size = 288; // Matches imageWidth in app.json, including the PNG's padding.

/** One short ribbon gleam per launch; connecting to a computer never holds it up. */
export function StartupSplash({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { ready } = useRemote();
  const reduced = useReducedMotion();
  const foreground = useForeground();
  const [loaded, setLoaded] = useState(false);
  const [settled, setSettled] = useState(false);
  const [visible, setVisible] = useState(true);
  const progress = useAnimatedValue(0);
  const opacity = useAnimatedValue(1);

  useEffect(() => {
    if (!loaded || !foreground || settled) return;
    SplashScreen.hide();
    const entrance = Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? 0 : 850,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    entrance.start(({ finished }) => {
      if (finished) setSettled(true);
    });
    return () => entrance.stop();
  }, [loaded, foreground, settled, reduced, progress]);

  useEffect(() => {
    if (!ready || !settled || !foreground || !visible) return;
    const exit = Animated.timing(opacity, {
      toValue: 0,
      duration: reduced ? 0 : 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    exit.start(({ finished }) => {
      if (finished) setVisible(false);
    });
    return () => exit.stop();
  }, [ready, settled, foreground, visible, reduced, opacity]);

  return (
    <View style={styles.root}>
      <View
        style={styles.root}
        accessibilityElementsHidden={visible}
        importantForAccessibility={visible ? "no-hide-descendants" : "auto"}
        pointerEvents={visible ? "none" : "auto"}
      >
        {children}
      </View>
      <StatusBar style={visible || t.kind === "dark" ? "light" : "dark"} />
      {visible && (
        <Animated.View
          style={[styles.cover, { opacity }]}
          accessible
          accessibilityLabel="Relay is starting"
          accessibilityRole="progressbar"
        >
          <Animated.View
            style={{
              transform: [
                {
                  scale: reduced
                    ? 1
                    : progress.interpolate({
                        inputRange: [0, 0.45, 1],
                        outputRange: [1, 1.055, 1],
                      }),
                },
                {
                  rotate: reduced
                    ? "0deg"
                    : progress.interpolate({
                        inputRange: [0, 0.45, 1],
                        outputRange: ["0deg", "-2deg", "0deg"],
                      }),
                },
              ],
            }}
          >
            <Image
              source={logo}
              style={styles.logo}
              fadeDuration={0}
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
              accessible={false}
            />
            {!reduced && (
              <MaskedView
                style={StyleSheet.absoluteFill}
                maskElement={
                  <Image source={logo} style={styles.logo} fadeDuration={0} />
                }
              >
                <Animated.View
                  style={[
                    styles.gleam,
                    {
                      opacity: progress.interpolate({
                        inputRange: [0, 0.15, 0.5, 0.85, 1],
                        outputRange: [0, 0, 0.65, 0, 0],
                      }),
                      transform: [
                        {
                          translateX: progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [50, 220],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={["#ffffff00", "#ffffff", "#ffffff00"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              </MaskedView>
            )}
          </Animated.View>
          <Animated.View
            style={[styles.wordmark, { opacity: reduced ? 1 : progress }]}
          >
            <Text style={styles.name}>Relay</Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#1e1e21",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: size, height: size },
  gleam: { position: "absolute", top: 0, bottom: 0, left: 0, width: 48 },
  wordmark: { position: "absolute", top: "50%", marginTop: 92 },
  name: { color: "#e1e1e5", fontSize: 24, fontWeight: "500", letterSpacing: 2 },
});
