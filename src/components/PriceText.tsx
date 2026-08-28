import React from 'react';
import { Text, type TextProps } from 'react-native';

/**
 * Text with tabular numerals — digits keep fixed width so columns of
 * numbers never jitter or misalign.
 */
export function PriceText({ style, ...rest }: TextProps) {
  return <Text {...rest} style={[{ fontVariant: ['tabular-nums'] }, style]} />;
}
