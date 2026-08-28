import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RangeBar } from '@/src/components/RangeBar';
import { RollingBars } from '@/src/components/RollingBars';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { Segmented } from '@/src/components/Segmented';
import { formatDate } from '@/src/data/format';
import { getMeta } from '@/src/data/store';
import { useSettings, type Appearance } from '@/src/state/SettingsContext';
import { tick } from '@/src/theme/haptics';
import { layout, space, typo, type Theme } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { RowViz } from '@/shared/types';

const PREVIEW_ROLLING = [-0.9, -0.5, -0.7, -0.2, 0.1, -0.1, 0.4, 0.7, 0.5, 0.9, 1.2, 1.0, 1.5];

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function SettingsScreen() {
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();
  const { settings, update } = useSettings();
  const meta = getMeta();

  const vizOption = (value: RowViz, label: string, hint: string, preview: React.ReactNode) => {
    const selected = settings.rowViz === value;
    return (
      <Pressable
        style={[s.vizOption, selected && s.vizOptionSelected]}
        onPress={() => {
          if (!selected) {
            tick();
            update({ rowViz: value });
          }
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.vizLabel}>{label}</Text>
          <Text style={s.vizHint}>{hint}</Text>
        </View>
        <View style={s.vizPreview}>{preview}</View>
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={20}
          color={selected ? theme.colors.accent : theme.colors.textTertiary}
          style={{ marginLeft: space.s12 }}
        />
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top }}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.s24 }}>
        <Text style={s.sectionTitle}>ROW VISUALIZATION</Text>
        <View style={s.card}>
          {vizOption(
            'range',
            '52-week range',
            'Low, high, and latest price',
            <RangeBar low={0} high={1} latest={0.68} />,
          )}
          <View style={s.cardSeparator} />
          {vizOption(
            'rolling',
            'Rolling blended score',
            'Momentum score through time',
            <RollingBars values={PREVIEW_ROLLING} />,
          )}
        </View>

        <Text style={s.sectionTitle}>APPEARANCE</Text>
        <View style={[s.card, { padding: space.s8 }]}>
          <Segmented
            options={APPEARANCES}
            value={settings.appearance}
            onChange={(appearance) => update({ appearance })}
          />
        </View>

        <Text style={s.sectionTitle}>DATA</Text>
        <View style={s.card}>
          {infoRow(s, 'As of', formatDate(meta.asOf))}
          <View style={s.cardSeparator} />
          {infoRow(s, 'Generated', formatDate(meta.generatedAt.slice(0, 10)))}
          <View style={s.cardSeparator} />
          {infoRow(s, 'Universe', `${meta.universeCount} stocks · ${meta.rankedCount} ranked`)}
          <View style={s.cardSeparator} />
          {infoRow(s, 'Source', meta.source === 'mock' ? 'Mock snapshot' : 'FMP (adjusted daily)')}
        </View>
        <Text style={s.footnote}>
          Data is a static snapshot. It updates only when you ask Claude Code to run a refresh.
        </Text>
      </ScrollView>
    </View>
  );
}

function infoRow(s: ReturnType<typeof styles>, label: string, value: string) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

const styles = (theme: Theme) =>
  StyleSheet.create({
    sectionTitle: {
      ...typo.micro,
      letterSpacing: 0.8,
      color: theme.colors.textTertiary,
      marginTop: space.s20,
      marginBottom: space.s8,
      marginHorizontal: layout.gutter,
    },
    card: {
      marginHorizontal: layout.gutter,
      backgroundColor: theme.colors.bgElevated,
      borderRadius: layout.radius,
      overflow: 'hidden',
    },
    cardSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.separator,
      marginLeft: space.s16,
    },
    vizOption: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: space.s16,
    },
    vizOptionSelected: {},
    vizLabel: { ...typo.body, fontWeight: '500', color: theme.colors.text },
    vizHint: { ...typo.caption, color: theme.colors.textSecondary, marginTop: 2 },
    vizPreview: { marginLeft: space.s8 },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: space.s16,
      paddingVertical: 13,
    },
    infoLabel: { ...typo.body, fontSize: 15, color: theme.colors.text },
    infoValue: {
      ...typo.body,
      fontSize: 15,
      color: theme.colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    footnote: {
      ...typo.caption,
      color: theme.colors.textTertiary,
      marginTop: space.s8,
      marginHorizontal: layout.gutter + space.s4,
      lineHeight: 16,
    },
  });
