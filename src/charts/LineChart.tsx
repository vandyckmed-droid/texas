import { Canvas, Circle, Group, Line, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Easing,
  interpolateColor,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { motion } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { ChartFile } from '@/shared/types';
import {
  LINE_POINTS,
  padDomain,
  plotWidth,
  resampleToN,
  windowBars,
  yFor,
  type ChartFrame,
  type WindowKey,
} from './scales';

/**
 * Hex → rgba string. interpolateColor blends rgba() reliably, so the fill can
 * be interpolated across the morph the same way the stroke is.
 */
function withAlpha(hex: string, a: number): string {
  'worklet';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const FILL_ALPHA = 0.18;

interface Props {
  chart: ChartFile;
  window: WindowKey;
  frame: ChartFrame;
  /** Crosshair state owned by the parent: bar index within the window, −1 off. */
  activeIndex: SharedValue<number>;
  crossOpacity: SharedValue<number>;
}

/**
 * Price line with gradient fill. Window changes morph the existing path into
 * the new one (Yahoo-style): every window is resampled to LINE_POINTS points,
 * so Skia path interpolation is structurally valid, and paths are prebuilt in
 * pixel space so shape and scale reshape together.
 */
export function LineChart({ chart, window: win, frame, activeIndex, crossOpacity }: Props) {
  const theme = useTheme();
  const plotW = plotWidth(frame);
  const baseY = frame.height - frame.padBottom;

  // Only the window on screen is built. Building all four kept four Skia paths
  // alive per ticker, and flicking through names with prev/next piled them up
  // faster than they could be collected. The morph still works because the
  // outgoing shape already lives in fromPath.
  const built = useMemo(() => {
    const n = windowBars(win, chart.c.length);
    const slice = chart.c.slice(chart.c.length - n);
    const [lo, hi] = padDomain(Math.min(...slice), Math.max(...slice));
    const pts = resampleToN(slice, LINE_POINTS);
    const path = Skia.Path.Make();
    pts.forEach((v, k) => {
      const x = (k / (LINE_POINTS - 1)) * plotW;
      const y = yFor(v, lo, hi, frame);
      if (k === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    return { path, lo, hi, up: slice[n - 1] >= slice[0], n };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, win, frame.width, frame.height]);

  const colorFor = (up: boolean) => (up ? theme.colors.positive : theme.colors.negative);

  const fromPath = useSharedValue(built.path);
  const toPath = useSharedValue(built.path);
  const fromColor = useSharedValue(colorFor(built.up));
  const toColor = useSharedValue(colorFor(built.up));
  const progress = useSharedValue(1);

  const mounted = useRef(false);
  useEffect(() => {
    const target = built;
    if (!mounted.current) {
      // First paint: settle immediately so the chart is never blank waiting on
      // an animation that may not have started.
      mounted.current = true;
      fromPath.value = target.path;
      toPath.value = target.path;
      fromColor.value = colorFor(target.up);
      toColor.value = colorFor(target.up);
      progress.value = 1;
      return;
    }
    const mid =
      progress.value < 1
        ? (toPath.value.interpolate(fromPath.value, progress.value) ?? toPath.value)
        : toPath.value;
    if (!target.path.isInterpolatable(mid)) {
      // Structural mismatch should be impossible (fixed-N resampling); jump.
      fromPath.value = target.path;
    } else {
      fromPath.value = mid;
    }
    fromColor.value = toColor.value;
    toPath.value = target.path;
    toColor.value = colorFor(target.up);
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: motion.chartMorph,
      easing: Easing.out(Easing.cubic),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, theme.dark]);

  const linePath = useDerivedValue(() => {
    if (progress.value >= 1) return toPath.value;
    return toPath.value.interpolate(fromPath.value, progress.value) ?? toPath.value;
  });
  const areaPath = useDerivedValue(() => {
    const p = linePath.value.copy();
    p.lineTo(plotW, baseY);
    p.lineTo(0, baseY);
    p.close();
    return p;
  });
  const strokeColor = useDerivedValue(() =>
    interpolateColor(progress.value, [0, 1], [fromColor.value, toColor.value]),
  );
  const gradientColors = useDerivedValue(() => [
    interpolateColor(
      progress.value,
      [0, 1],
      [withAlpha(fromColor.value, FILL_ALPHA), withAlpha(toColor.value, FILL_ALPHA)],
    ),
    interpolateColor(
      progress.value,
      [0, 1],
      [withAlpha(fromColor.value, 0), withAlpha(toColor.value, 0)],
    ),
  ]);

  // Crosshair snaps to real bars of the current window.
  const { lo, hi, n } = built;
  const closes = chart.c.slice(chart.c.length - n);
  const cx = useDerivedValue(() =>
    activeIndex.value < 0 ? -100 : (activeIndex.value / Math.max(1, n - 1)) * plotW,
  );
  const cy = useDerivedValue(() =>
    activeIndex.value < 0 ? -100 : yFor(closes[Math.min(activeIndex.value, n - 1)], lo, hi, frame),
  );
  const p1 = useDerivedValue(() => vec(cx.value, frame.padTop));
  const p2 = useDerivedValue(() => vec(cx.value, frame.height - frame.padBottom));

  return (
    <Canvas style={{ width: frame.width, height: frame.height }}>
      <Path path={areaPath} style="fill">
        <LinearGradient
          start={vec(0, frame.padTop)}
          end={vec(0, frame.height)}
          colors={gradientColors}
        />
      </Path>
      <Path
        path={linePath}
        style="stroke"
        strokeWidth={2}
        strokeJoin="round"
        strokeCap="round"
        color={strokeColor}
      />
      <Group opacity={crossOpacity}>
        <Line p1={p1} p2={p2} strokeWidth={1} color={theme.colors.crosshair} />
        <Circle cx={cx} cy={cy} r={6.5} color={`${theme.colors.crosshair}33`} />
        <Circle cx={cx} cy={cy} r={3.5} color={strokeColor} />
      </Group>
    </Canvas>
  );
}
