import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersonalTrackerScreen } from './src/screens/PersonalTrackerScreen';

export default function App() {
	return (
		<SafeAreaProvider>
			<StatusBar style="dark" />
			<PersonalTrackerScreen />
		</SafeAreaProvider>
	);
}
