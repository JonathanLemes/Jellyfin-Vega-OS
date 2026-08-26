import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {Button} from './Button';
import {JellyfinLogo} from './JellyfinLogo';
import {colors, spacing, typography} from '../theme/theme';

/** Root container giving every screen the Jellyfin dark background. */
export const Screen = ({children, style}: {children: React.ReactNode; style?: object}) => (
  <View style={[styles.screen, style]}>{children}</View>
);

/** Full-screen spinner shown while a screen's first request is in flight. */
export const LoadingView = ({label}: {label?: string}) => (
  <View style={styles.centered}>
    <ActivityIndicator color={colors.accent} size="large" />
    {label ? <Text style={styles.loadingLabel}>{label}</Text> : null}
  </View>
);

/** Splash shown while the persisted session is being restored at launch. */
export const SplashView = () => (
  <View style={styles.centered}>
    <JellyfinLogo size={110} />
    <ActivityIndicator color={colors.accent} size="large" style={styles.splashSpinner} />
  </View>
);

interface ErrorProps {
  message: string;
  onRetry?: () => void;
  onBack?: () => void;
}

/** Terminal error state with a way out; a TV user cannot reload the page. */
export const ErrorView = ({message, onRetry, onBack}: ErrorProps) => (
  <View style={styles.centered}>
    <Text style={styles.errorTitle}>Something went wrong</Text>
    <Text style={styles.errorMessage}>{message}</Text>
    <View style={styles.errorActions}>
      {onRetry ? (
        <Button autoFocus label="Try again" onPress={onRetry} variant="primary" />
      ) : null}
      {onBack ? (
        <Button
          autoFocus={!onRetry}
          label="Go back"
          onPress={onBack}
          style={styles.errorSecondary}
        />
      ) : null}
    </View>
  </View>
);

/** Neutral state for a library or search that returned nothing. */
export const EmptyView = ({message}: {message: string}) => (
  <View style={styles.centered}>
    <Text style={styles.emptyMessage}>{message}</Text>
  </View>
);

const styles = StyleSheet.create({
  screen: {backgroundColor: colors.background, flex: 1},
  centered: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  loadingLabel: {...typography.bodySecondary, marginTop: spacing.md},
  splashSpinner: {marginTop: spacing.xl},
  errorTitle: {...typography.title, marginBottom: spacing.sm},
  errorMessage: {
    ...typography.bodySecondary,
    marginBottom: spacing.xl,
    maxWidth: 720,
    textAlign: 'center',
  },
  errorActions: {flexDirection: 'row'},
  errorSecondary: {marginLeft: spacing.md},
  emptyMessage: {...typography.bodySecondary, textAlign: 'center'},
});
