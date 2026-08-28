import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable } from 'react-native';
import { useWatchlist } from '@/src/state/WatchlistContext';
import { useTheme } from '@/src/theme/useTheme';

/** Watchlist toggle — a 44pt tap target with a light impact haptic. */
export function WatchStar({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const { colors } = useTheme();
  const { has, toggle } = useWatchlist();
  const active = has(symbol);
  return (
    <Pressable
      onPress={() => toggle(symbol)}
      hitSlop={12}
      style={{ width: 34, height: 44, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="button"
      accessibilityLabel={active ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
    >
      <Ionicons
        name={active ? 'star' : 'star-outline'}
        size={size}
        color={active ? colors.accent : colors.textTertiary}
      />
    </Pressable>
  );
}
