import { useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { TrackingScreen } from './src/screens/TrackingScreen';
import { colors } from './src/theme';

const AppContent = () => {
  const { authReady, session } = useAuth();
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  if (!authReady) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.text} size="large" />
      </View>
    );
  }

  if (session) {
    return <TrackingScreen />;
  }

  if (showForgotPassword) {
    return <ForgotPasswordScreen onBackToLogin={() => setShowForgotPassword(false)} />;
  }

  return <LoginScreen onForgotPassword={() => setShowForgotPassword(true)} />;
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
