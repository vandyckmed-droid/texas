import { Text, View } from 'react-native';

import rankings from '@/data/rankings.json';

export default function RanksRoute() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>
        Ranks — {rankings.stocks.length} stocks, as of {rankings.asOf}
      </Text>
    </View>
  );
}
