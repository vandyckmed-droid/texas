import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { tick } from '@/src/theme/haptics';
import { layout, motion, type Theme } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Compact renders tighter, for inline chart controls. */
  compact?: boolean;
}

/** iOS-style segmented control with a sliding indicator and selection haptic. */
export function Segmented<T extends string>({ options, value, onChange, compact }: Props<T>) {
  const theme = useTheme();
  const s = styles(theme, compact ?? false);
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const x = useSharedValue(0);
  const segW = width / options.length;

  useEffect(() => {
    x.value = withTiming(index * segW, {
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
    });
  }, [index, segW, x]);

  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={s.container} onLayout={onLayout}>
      {width > 0 && (
        <Animated.View style={[s.indicator, { width: segW - 4 }, indicatorStyle]} />
      )}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            style={s.segment}
            onPress={() => {
              if (!selected) {
                tick();
                onChange(o.value);
              }
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[s.label, selected && s.labelSelected]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = (theme: Theme, compact: boolean) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      backgroundColor: theme.colors.fillSubtle,
      borderRadius: layout.radiusSmall + 2,
      padding: 2,
      height: compact ? 30 : 34,
    },
    indicator: {
      position: 'absolute',
      top: 2,
      left: 2,
      bottom: 2,
      borderRadius: layout.radiusSmall,
      ...(theme.dark
        ? { backgroundColor: '#26262E' }
        : {
            backgroundColor: '#FFFFFF',
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
          }),
    },
    segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    label: {
      fontSize: compact ? 12.5 : 13.5,
      fontWeight: '500',
      color: theme.colors.textSecondary,
    },
    labelSelected: { color: theme.colors.text, fontWeight: '600' },
  });
