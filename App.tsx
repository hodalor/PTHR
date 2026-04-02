import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { TrackingScreen } from './src/screens/TrackingScreen';
import { colors } from './src/theme';

const AppContent = () => {
  const { authReady, session } = useAuth();

  if (!authReady) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.text} size="large" />
      </View>
    );
  }

  return <>{session ? <TrackingScreen /> : <LoginScreen />}</>;
};

export default function App() {
  return (
    <AuthProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <AppContent />
      </SafeAreaView>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
