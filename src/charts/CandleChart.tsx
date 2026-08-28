import { Canvas, Circle, Group, Line, Path, Skia, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { motion } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { ChartFile } from '@/shared/types';
import { padDomain, windowBars, yFor, type ChartFrame, type WindowKey } from './scales';

interface Props {
  chart: ChartFile;
  window: WindowKey;
  frame: ChartFrame;
  activeIndex: SharedValue<number>;
  crossOpacity: SharedValue<number>;
}

/**
 * OHLC candles. Window switches animate the visible bar count and y-domain
 * together, so bars smoothly rescale and slide rather than snapping. Paths are
 * rebuilt per frame in a worklet from the full arrays — ≤253 rects, well
 * within budget; newest bar stays anchored at the right edge.
 */
export function CandleChart({ chart, window: win, frame, activeIndex, crossOpacity }: Props) {
  const theme = useTheme();
  const plotW = frame.width - frame.labelGutter;
  const len = chart.c.length;

  const domains = useMemo(() => {
    const out = {} as Record<WindowKey, { lo: number; hi: number; n: number }>;
    for (const key of ['1M', '3M', '6M', '12M'] as WindowKey[]) {
      const n = windowBars(key, len);
      const lows = chart.l.slice(len - n);
      const highs = chart.h.slice(len - n);
      const [lo, hi] = padDomain(Math.min(...lows), Math.max(...highs));
      out[key] = { lo, hi, n };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart]);

  const aN = useSharedValue(domains[win].n);
  const aLo = useSharedValue(domains[win].lo);
  const aHi = useSharedValue(domains[win].hi);

  useEffect(() => {
    const d = domains[win];
    const cfg = { duration: motion.base, easing: Easing.out(Easing.cubic) };
    aN.value = withTiming(d.n, cfg);
    aLo.value = withTiming(d.lo, cfg);
    aHi.value = withTiming(d.hi, cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, domains]);

  const { o, h, l, c } = chart;

  const paths = useDerivedValue(() => {
    const n = aN.value;
    const lo = aLo.value;
    const hi = aHi.value;
    const count = Math.min(len, Math.max(1, Math.round(n)));
    const slot = plotW / n;
    const bodyW = Math.max(0.8, Math.min(slot * 0.72, slot - 0.6));
    const wicks = Skia.Path.Make();
    const up = Skia.Path.Make();
    const down = Skia.Path.Make();
    for (let k = 0; k < count; k++) {
      const i = len - count + k;
      const x = plotW - (count - k - 0.5) * slot;
      if (x < -slot) continue;
      const yH = yFor(h[i], lo, hi, frame);
      const yL = yFor(l[i], lo, hi, frame);
      wicks.moveTo(x, yH);
      wicks.lineTo(x, yL);
      const yO = yFor(o[i], lo, hi, frame);
      const yC = yFor(c[i], lo, hi, frame);
      const top = Math.min(yO, yC);
      const height = Math.max(1, Math.abs(yO - yC));
      const target = c[i] >= o[i] ? up : down;
      target.addRect(Skia.XYWHRect(x - bodyW / 2, top, bodyW, height));
    }
    return { wicks, up, down };
  });

  const wickPath = useDerivedValue(() => paths.value.wicks);
  const upPath = useDerivedValue(() => paths.value.up);
  const downPath = useDerivedValue(() => paths.value.down);

  // Crosshair: snap to bar centers of the settled window.
  const { n, lo, hi } = domains[win];
  const closes = c.slice(len - n);
  const cx = useDerivedValue(() => {
    if (activeIndex.value < 0) return -100;
    const slot = plotW / n;
    return plotW - (n - Math.min(activeIndex.value, n - 1) - 0.5) * slot;
  });
  const cy = useDerivedValue(() =>
    activeIndex.value < 0 ? -100 : yFor(closes[Math.min(activeIndex.value, n - 1)], lo, hi, frame),
  );
  const p1 = useDerivedValue(() => vec(cx.value, frame.padTop));
  const p2 = useDerivedValue(() => vec(cx.value, frame.height - frame.padBottom));

  return (
    <Canvas style={{ width: frame.width, height: frame.height }}>
      <Path path={wickPath} style="stroke" strokeWidth={1} color={theme.colors.textTertiary} />
      <Path path={upPath} color={theme.colors.positive} />
      <Path path={downPath} color={theme.colors.negative} />
      <Group opacity={crossOpacity}>
        <Line p1={p1} p2={p2} strokeWidth={1} color={theme.colors.crosshair} />
        <Circle cx={cx} cy={cy} r={3.5} color={theme.colors.crosshair} />
      </Group>
    </Canvas>
  );
}
