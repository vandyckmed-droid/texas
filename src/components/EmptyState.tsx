import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { space, typo, type Theme } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
}

export function EmptyState({ icon, title, hint }: Props) {
  const theme = useTheme();
  const s = styles(theme);
  return (
    <View style={s.container}>
      <Ionicons name={icon} size={30} color={theme.colors.textTertiary} />
      <Text style={s.title}>{title}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = (theme: Theme) =>
  StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.s24 },
    title: { ...typo.body, fontWeight: '600', color: theme.colors.textSecondary, marginTop: space.s12 },
    hint: {
      ...typo.caption,
      color: theme.colors.textTertiary,
      marginTop: space.s4,
      textAlign: 'center',
    },
  });
