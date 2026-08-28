import { Canvas, Circle, Group, Line, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
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
  resampleToN,
  windowBars,
  WINDOWS,
  yFor,
  type ChartFrame,
  type WindowKey,
} from './scales';

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
  const plotW = frame.width - frame.labelGutter;
  const baseY = frame.height - frame.padBottom;

  const built = useMemo(() => {
    const out = {} as Record<
      WindowKey,
      { path: ReturnType<typeof Skia.Path.Make>; lo: number; hi: number; up: boolean; n: number }
    >;
    for (const { key } of WINDOWS) {
      const n = windowBars(key, chart.c.length);
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
      out[key] = { path, lo, hi, up: slice[n - 1] >= slice[0], n };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, frame.width, frame.height]);

  const colorFor = (up: boolean) => (up ? theme.colors.positive : theme.colors.negative);

  const fromPath = useSharedValue(built[win].path);
  const toPath = useSharedValue(built[win].path);
  const fromColor = useSharedValue(colorFor(built[win].up));
  const toColor = useSharedValue(colorFor(built[win].up));
  const progress = useSharedValue(1);

  useEffect(() => {
    const target = built[win];
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
  }, [win, built, theme.dark]);

  const linePath = useDerivedValue(
    () => toPath.value.interpolate(fromPath.value, progress.value) ?? toPath.value,
  );
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
    `${toColor.value}2E`,
    `${toColor.value}00`,
  ]);

  // Crosshair snaps to real bars of the current window.
  const { lo, hi, n } = built[win];
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
