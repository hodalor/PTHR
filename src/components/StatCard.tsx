import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

type StatCardProps = {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  helper?: ReactNode;
};

export const StatCard = ({ label, value, tone = 'default', helper }: StatCardProps) => (
  <View style={styles.card}>
    <Text style={[styles.value, tone === 'success' ? styles.success : null, tone === 'warning' ? styles.warning : null, tone === 'danger' ? styles.danger : null]}>
      {value}
    </Text>
    <Text style={styles.label}>{label}</Text>
    {helper ? <View style={styles.helperWrap}>{helper}</View> : null}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    flex: 1,
    minWidth: 150,
    gap: 4,
  },
  value: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  helperWrap: {
    marginTop: 6,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
});

