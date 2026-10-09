import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Check, Copy, X } from "lucide-react-native";
import { keyOf, useImage, type Source } from "./useImage";
import { imageLimits } from "./lightbox-geometry";

export interface LightboxImage {
  source: Source;
  name: string;
}

const MAX_SCALE = 5;
const TAP_SCALE = 2.5;
// How far a finger may move and still tap, in dp.
const TAP_SLOP = 10;

type Size = { width: number; height: number };

/**
 * A message's images over the whole screen, like the desktop's viewer: swipe
 * between them, pinch or double-tap to zoom, drag around once zoomed, and swipe
 * down to close. Paging waits while an image is zoomed, so a drag moves it.
 */
export function Lightbox({
  images,
  index: first,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
}) {
  const [size, setSize] = useState<Size>();
  const [index, setIndex] = useState(first);
  const [zoomed, setZoomed] = useState(false);
  // A tap hides the bar, for an image whose top it covers.
  const [bar, setBar] = useState(true);
  const toggleBar = useCallback(() => setBar((shown) => !shown), []);
  const list = useRef<FlatList<LightboxImage>>(null);
  const paging = useMemo(() => Gesture.Native(), []);
  const drop = useSharedValue(0);

  // A turned phone keeps the same image in view.
  useEffect(() => {
    if (size) list.current?.scrollToOffset({ offset: index * size.width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size?.width]);

  const backdrop = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(drop.get()), [0, 400], [1, 0.2], "clamp"),
  }));
  const lifted = useAnimatedStyle(() => ({ transform: [{ translateY: drop.get() }] }));
  const dismiss = Gesture.Pan()
    .enabled(!zoomed)
    .maxPointers(1)
    .activeOffsetY([-14, 14])
    .failOffsetX([-14, 14])
    .onUpdate((e) => drop.set(e.translationY))
    .onEnd((e) => {
      if (Math.abs(e.translationY) > 120 || Math.abs(e.velocityY) > 1000) scheduleOnRN(onClose);
      else drop.set(withSpring(0));
    })
    .onFinalize((_, success) => {
      if (!success) drop.set(withSpring(0));
    });

  const image = images[index];
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]} />
        <GestureDetector gesture={dismiss}>
          <Animated.View
            style={[styles.fill, lifted]}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              if (width !== size?.width || height !== size?.height) setSize({ width, height });
            }}
          >
            {size && (
              <GestureDetector gesture={paging}>
                <FlatList
                  ref={list}
                  data={images}
                  keyExtractor={(item) => keyOf(item.source)}
                  horizontal
                  pagingEnabled
                  scrollEnabled={!zoomed}
                  showsHorizontalScrollIndicator={false}
                  initialScrollIndex={first}
                  getItemLayout={(_, i) => ({ length: size.width, offset: size.width * i, index: i })}
                  // Each page holds a whole data URL; only it and its neighbours stay drawn.
                  windowSize={3}
                  initialNumToRender={1}
                  maxToRenderPerBatch={1}
                  onMomentumScrollEnd={(e) => {
                    const next = Math.round(e.nativeEvent.contentOffset.x / size.width);
                    if (next !== index) {
                      setIndex(next);
                      setZoomed(false);
                    }
                  }}
                  renderItem={({ item, index: i }) => (
                    <Page
                      image={item}
                      size={size}
                      pager={paging}
                      active={i === index}
                      onZoom={setZoomed}
                      onTap={toggleBar}
                    />
                  )}
                />
              </GestureDetector>
            )}
          </Animated.View>
        </GestureDetector>
        {/* Its own provider: the screen's insets stop below the header, a modal covers it. */}
        <SafeAreaProvider style={styles.over} pointerEvents="box-none">
          {bar && (
            <Bar
              image={image}
              name={image?.name}
              count={images.length > 1 ? `${index + 1} of ${images.length}` : undefined}
              onClose={onClose}
            />
          )}
          {bar && images.length > 1 && images.length <= maxDots && (
            <Dots count={images.length} index={index} />
          )}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

function Bar({
  image,
  name,
  count,
  onClose,
}: {
  image?: LightboxImage;
  name?: string;
  count?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      style={[styles.bar, { paddingTop: insets.top + 8 }]}
    >
      <View style={styles.title}>
        <Text numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        {count && <Text style={styles.count}>{count}</Text>}
      </View>
      {image && <CopyImage key={keyOf(image.source)} source={image.source} />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        hitSlop={12}
        style={styles.close}
      >
        <X size={22} color="#fff" />
      </Pressable>
    </Animated.View>
  );
}

const maxDots = 12;

/** Where the swipe is, down by the thumb that swipes; past `maxDots` only the bar's count says. */
function Dots({ count, index }: { count: number; index: number }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      pointerEvents="none"
      style={[styles.dots, { bottom: insets.bottom + 20 }]}
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, i === index && styles.current]} />
      ))}
    </Animated.View>
  );
}

/**
 * Puts the image on the clipboard to paste into another app: sharing it would
 * need a native module the app doesn't have, and React Native's Share carries
 * only text on Android.
 */
function CopyImage({ source }: { source: Source }) {
  // The page already fetched it; this finds it in the cache.
  const { uri } = useImage(source);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);
  const base64 = uri?.startsWith("data:") ? uri.slice(uri.indexOf(",") + 1) : undefined;
  if (!base64) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Image copied" : "Copy image"}
      hitSlop={12}
      style={styles.close}
      onPress={() =>
        void Clipboard.setImageAsync(base64).then(() => {
          void Haptics.selectionAsync().catch(() => {});
          setCopied(true);
        }, (e) => Alert.alert("Couldn't copy the image", e instanceof Error ? e.message : String(e)))
      }
    >
      {copied ? <Check size={20} color="#fff" /> : <Copy size={20} color="#fff" />}
    </Pressable>
  );
}

/** One image, fitted to the screen, that zooms around the fingers and drags within its edges. */
function Page({
  image,
  size,
  pager,
  active,
  onZoom,
  onTap,
}: {
  image: LightboxImage;
  size: Size;
  pager: ReturnType<typeof Gesture.Native>;
  active: boolean;
  onZoom: (zoomed: boolean) => void;
  onTap: () => void;
}) {
  const { uri, failed } = useImage(image.source);
  const { width, height } = size;
  const [zoomed, setZoomed] = useState(false);
  // Width over height once loaded; fitted to the size of the moment, so a drag
  // stops at its edges after the phone unfolds or turns too.
  const ratio = useSharedValue(0);
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const start = useSharedValue({ scale: 1, x: 0, y: 0 });
  const focal = useSharedValue({ x: 0, y: 0 });
  const pinching = useSharedValue(false);
  const wasZoomed = useSharedValue(false);

  // Swiped away from, it's fitted again for when it comes back.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setZoomed(false);
  }
  useEffect(() => {
    if (active) return;
    scale.set(1);
    x.set(0);
    y.set(0);
    wasZoomed.set(false);
  }, [active, scale, x, y, wasZoomed]);

  const report = (s: number) => {
    "worklet";
    const now = s > 1.01;
    if (now === wasZoomed.get()) return;
    wasZoomed.set(now);
    scheduleOnRN(setZoomed, now);
    scheduleOnRN(onZoom, now);
  };
  const edge = (s: number) => {
    "worklet";
    return imageLimits(ratio.get(), width, height, s);
  };
  const within = (value: number, limit: number) => {
    "worklet";
    return Math.min(limit, Math.max(-limit, value));
  };
  // Clamp on the UI thread, including when the natural ratio arrives mid-zoom.
  useAnimatedReaction(
    () => ({ ratio: ratio.get(), width, height }),
    (next, previous) => {
      if (previous && next.ratio === previous.ratio && next.width === previous.width && next.height === previous.height) return;
      const limit = imageLimits(next.ratio, next.width, next.height, scale.get());
      x.set(within(x.get(), limit.x));
      y.set(within(y.get(), limit.y));
    },
  );
  const zoomTo = (s: number, toX: number, toY: number) => {
    "worklet";
    const limit = edge(s);
    scale.set(withTiming(s));
    x.set(withTiming(within(toX, limit.x)));
    y.set(withTiming(within(toY, limit.y)));
    report(s);
  };

  const pinch = Gesture.Pinch()
    .blocksExternalGesture(pager)
    .enabled(!!uri)
    .onTouchesMove((event, manager) => {
      if (event.numberOfTouches < 2) manager.fail();
    })
    .onStart((e) => {
      pinching.set(true);
      start.set({ scale: scale.get(), x: x.get(), y: y.get() });
      focal.set({ x: e.focalX - width / 2, y: e.focalY - height / 2 });
    })
    .onUpdate((e) => {
      const from = start.get();
      const s = Math.min(MAX_SCALE, Math.max(0.8, from.scale * e.scale));
      // The point between the fingers stays under them.
      const fx = e.focalX - width / 2;
      const fy = e.focalY - height / 2;
      x.set(fx - (focal.get().x - from.x) * (s / from.scale));
      y.set(fy - (focal.get().y - from.y) * (s / from.scale));
      scale.set(s);
    })
    .onFinalize(() => {
      if (!pinching.get()) return;
      pinching.set(false);
      const s = Math.min(MAX_SCALE, Math.max(1, scale.get()));
      zoomTo(s, s === 1 ? 0 : x.get(), s === 1 ? 0 : y.get());
    });
  const pan = Gesture.Pan()
    .enabled(zoomed)
    .maxPointers(1)
    .onStart(() => start.set({ scale: scale.get(), x: x.get(), y: y.get() }))
    .onUpdate((e) => {
      const limit = edge(scale.get());
      x.set(within(start.get().x + e.translationX, limit.x));
      y.set(within(start.get().y + e.translationY, limit.y));
    })
    .onEnd((e) => {
      const limit = edge(scale.get());
      x.set(withDecay({ velocity: e.velocityX, clamp: [-limit.x, limit.x] }));
      y.set(withDecay({ velocity: e.velocityY, clamp: [-limit.y, limit.y] }));
    });
  // A tap has no distance limit of its own, so a quick swipe to the next
  // image would count as one.
  const doubleTap = Gesture.Tap()
    .enabled(!!uri)
    .numberOfTaps(2)
    .maxDistance(TAP_SLOP)
    .onEnd((e) => {
      if (scale.get() > 1.01) zoomTo(1, 0, 0);
      // Zooms in on the point tapped.
      else zoomTo(TAP_SCALE, -(e.x - width / 2) * (TAP_SCALE - 1), -(e.y - height / 2) * (TAP_SCALE - 1));
    });
  // Waits out a second tap, so it only fires when a double tap didn't.
  const tap = Gesture.Tap().maxDistance(TAP_SLOP).onEnd(() => scheduleOnRN(onTap));

  const transform = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));
  return (
    <GestureDetector
      gesture={Gesture.Race(Gesture.Exclusive(doubleTap, tap), Gesture.Simultaneous(pinch, pan))}
    >
      <View style={[styles.page, { width, height }]}>
        {uri ? (
          <Animated.Image
            source={{ uri }}
            accessibilityLabel={image.name}
            resizeMode="contain"
            style={[{ width, height }, transform]}
            onLoad={(e) => {
              const natural = e.nativeEvent.source;
              if (natural.width && natural.height) ratio.set(natural.width / natural.height);
            }}
          />
        ) : failed ? (
          <Text style={styles.failed}>This image couldn’t be loaded.</Text>
        ) : (
          <ActivityIndicator color="#fff" />
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { backgroundColor: "#000" },
  page: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  over: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  title: { flex: 1, gap: 2 },
  name: { color: "#fff", fontSize: 15, fontWeight: "600" },
  count: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  close: { padding: 4 },
  failed: { color: "rgba(255,255,255,0.7)", fontSize: 14 },
  dots: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 7,
  },
  // The outline keeps them visible over a white screenshot.
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.3)",
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  current: { backgroundColor: "#fff" },
});
