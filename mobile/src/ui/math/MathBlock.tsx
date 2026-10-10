import { memo, useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { mono, useTheme } from "../theme";
import { RenderFrame } from "../renders/RenderFrame";
import { renderTheme } from "../renders/render-theme";
import { mathDocument } from "./math-page";

/** A formula's source, for until it is typeset and where it can't be. */
function Source({ tex }: { tex: string }) {
  const t = useTheme();
  return (
    <Text selectable style={[styles.source, { color: t.muted }]}>
      {tex}
    </Text>
  );
}

/**
 * A display formula, typeset by KaTeX in a WebView of its own. While it is
 * still arriving, and if it can't be drawn, its source shows instead.
 */
export const MathBlock = memo(function MathBlock({
  tex,
  closed,
}: {
  tex: string;
  closed: boolean;
}) {
  const t = useTheme();
  const page = useMemo(
    () => (closed && tex.trim() ? mathDocument(tex, renderTheme(t)) : undefined),
    [closed, tex, t],
  );
  if (!page) return <Source tex={tex} />;
  return (
    <RenderFrame page={page} height={44} placeholder={<Source tex={tex} />} />
  );
});

const styles = StyleSheet.create({
  source: { fontFamily: mono, fontSize: 12.5, lineHeight: 18 },
});
