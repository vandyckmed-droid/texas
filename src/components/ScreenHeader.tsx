import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { layout, space, typo, type Theme } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function ScreenHeader({ title, subtitle, right }: Props) {
  const theme = useTheme();
  const s = styles(theme);
  return (
    <View style={s.container}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: layout.gutter,
      paddingTop: space.s8,
      paddingBottom: space.s12,
    },
    title: { ...typo.largeTitle, color: theme.colors.text },
    subtitle: { ...typo.caption, color: theme.colors.textSecondary, marginTop: 3 },
  });
