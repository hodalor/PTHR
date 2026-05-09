import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

export const LoginScreen = () => {
  const { apiBaseUrl, isAuthenticating, login, setApiBaseUrl } = useAuth();
  const [backendUrl, setBackendUrl] = useState(apiBaseUrl);
  const [tenantId, setTenantId] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setBackendUrl(apiBaseUrl);
  }, [apiBaseUrl]);

  const handleLogin = async () => {
    setError('');
    const normalizedTenantId = tenantId.trim().toLowerCase();
    if (!normalizedTenantId) {
      setError('Tenant ID is required');
      return;
    }
    if (!identifier.trim() || !password) {
      setError('Username and password are required');
      return;
    }
    try {
      await setApiBaseUrl(backendUrl.trim() || apiBaseUrl);
      await login(normalizedTenantId, identifier.trim(), password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>PTHR Mobile</Text>
        <Text style={styles.title}>Live employee location tracking</Text>
        <Text style={styles.subtitle}>Sign in with employee ID or username, then keep background tracking active for iOS and Android.</Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Backend URL</Text>
          <TextInput
            value={backendUrl}
            onChangeText={setBackendUrl}
            placeholder="http://192.168.1.10:8000"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Tenant ID</Text>
          <TextInput
            value={tenantId}
            onChangeText={setTenantId}
            placeholder="master or acme-ghana"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Username or Employee ID</Text>
          <TextInput
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="HR00000001"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            style={styles.input}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.button} onPress={handleLogin} disabled={isAuthenticating}>
          {isAuthenticating ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>Sign In</Text>}
        </Pressable>

        <Text style={styles.helper}>Backend endpoint: {apiBaseUrl}</Text>
        <Text style={styles.helper}>For a physical phone, use your computer&apos;s LAN IP like `http://192.168.x.x:8000` instead of localhost.</Text>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 14,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  buttonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  helper: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
});
