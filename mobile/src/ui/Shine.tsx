import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
} from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useForeground, useReducedMotion } from "./motion";
import { useTheme } from "./theme";

// The desktop's .live-shine (src/components/agent-trace.css): a 4.5rem band of
// the text colour crossing a muted label every 2.2s.
const band = 72;

/** A live label: muted, with a highlight sweeping across it. */
export function Shine({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const foreground = useForeground();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(-band)).current;
  const moving = !!width && !reduced && foreground;
  useEffect(() => {
    if (!moving) return;
    x.setValue(-band);
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: width + band,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [moving, width, x]);
  const label = (color: string) => (
    <Text numberOfLines={1} style={[style, { color }]}>
      {children}
    </Text>
  );
  if (reduced) return label(t.muted);
  return (
    <MaskedView
      style={styles.shrink}
      maskElement={label("#000")}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {label(t.muted)}
      <Animated.View
        pointerEvents="none"
        style={[styles.band, { transform: [{ translateX: x }] }]}
      >
        <LinearGradient
          colors={[fade(t.text, 0), t.text, fade(t.text, 0)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </MaskedView>
  );
}

/** `#rrggbb` at `alpha`, so the band fades to its own colour, not to grey. */
function fade(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  band: { position: "absolute", top: 0, bottom: 0, left: 0, width: band },
});
