import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';
import {
  confirmPasswordReset,
  requestPasswordReset,
  verifyPasswordResetOtp,
} from '../services/auth';

type ForgotPasswordScreenProps = {
  onBackToLogin: () => void;
};

type Step = 'request' | 'verify' | 'done';

export const ForgotPasswordScreen = ({ onBackToLogin }: ForgotPasswordScreenProps) => {
  const { apiBaseUrl } = useAuth();
  const [step, setStep] = useState<Step>('request');
  const [tenantId, setTenantId] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [channelsSent, setChannelsSent] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const handleRequestCode = async () => {
    setError('');
    setInfo('');
    const normalizedTenantId = tenantId.trim().toLowerCase();
    if (!normalizedTenantId) {
      setError('Tenant ID is required');
      return;
    }
    if (!identifier.trim()) {
      setError('Username or employee ID is required');
      return;
    }
    setLoading(true);
    try {
      const response = await requestPasswordReset(apiBaseUrl, {
        tenantId: normalizedTenantId,
        username: identifier.trim(),
        channels: ['email', 'sms'],
      });
      if (!response.resetToken) {
        setInfo(response.message || 'If an account matches, a reset code has been sent.');
        return;
      }
      setResetToken(response.resetToken);
      setMaskedEmail(response.maskedEmail || '');
      setMaskedPhone(response.maskedPhone || '');
      setChannelsSent(Array.isArray(response.channelsSent) ? response.channelsSent : []);
      setInfo(response.message || 'Reset code sent.');
      setStep('verify');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to request reset code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndReset = async () => {
    setError('');
    setInfo('');
    if (!otp.trim()) {
      setError('Enter the OTP sent to your email and/or phone');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await verifyPasswordResetOtp(apiBaseUrl, {
        tenantId: tenantId.trim().toLowerCase(),
        resetToken,
        otp: otp.trim(),
      });
      const response = await confirmPasswordReset(apiBaseUrl, {
        tenantId: tenantId.trim().toLowerCase(),
        resetToken,
        otp: otp.trim(),
        newPassword,
      });
      setInfo(response.message || 'Password updated.');
      setStep('done');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Unable to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>PTHR Mobile</Text>
        <Text style={styles.title}>{step === 'done' ? 'Password updated' : 'Reset password'}</Text>
        <Text style={styles.subtitle}>
          We send a one-time code to the email and phone on your employee profile (pay-as-you-go SMS/email).
        </Text>

        {step === 'request' ? (
          <>
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
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {info ? <Text style={styles.info}>{info}</Text> : null}
            <Pressable style={styles.button} onPress={handleRequestCode} disabled={loading}>
              {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>Send reset code</Text>}
            </Pressable>
          </>
        ) : null}

        {step === 'verify' ? (
          <>
            <Text style={styles.info}>
              Code sent via {channelsSent.join(' & ') || 'available channels'}
              {maskedEmail ? ` • ${maskedEmail}` : ''}
              {maskedPhone ? ` • ${maskedPhone}` : ''}
            </Text>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>OTP code</Text>
              <TextInput
                value={otp}
                onChangeText={setOtp}
                placeholder="6-digit code"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                style={styles.input}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>New password</Text>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="New password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                style={styles.input}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Confirm password</Text>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                style={styles.input}
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {info ? <Text style={styles.info}>{info}</Text> : null}
            <Pressable style={styles.button} onPress={handleVerifyAndReset} disabled={loading}>
              {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>Update password</Text>}
            </Pressable>
            <Pressable style={styles.linkButton} onPress={handleRequestCode} disabled={loading}>
              <Text style={styles.linkText}>Resend code</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'done' ? (
          <>
            {info ? <Text style={styles.info}>{info}</Text> : null}
            <Pressable style={styles.button} onPress={onBackToLogin}>
              <Text style={styles.buttonText}>Back to sign in</Text>
            </Pressable>
          </>
        ) : null}

        {step !== 'done' ? (
          <Pressable style={styles.linkButton} onPress={onBackToLogin} disabled={loading}>
            <Text style={styles.linkText}>Back to sign in</Text>
          </Pressable>
        ) : null}
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
  linkButton: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  linkText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  info: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
});
