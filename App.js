import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BalanceScreen } from './src/screens/BalanceScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <BalanceScreen />
    </SafeAreaProvider>
  );
}
