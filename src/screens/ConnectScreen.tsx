import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {Button} from '../components/Button';
import {Focusable} from '../components/Focusable';
import {JellyfinLogo} from '../components/JellyfinLogo';
import {Screen} from '../components/Screen';
import {
  authenticateByName,
  authenticateWithQuickConnect,
  getPublicUsers,
  initiateQuickConnect,
  isQuickConnectEnabled,
  pollQuickConnect,
  probeServer,
} from '../api/jellyfin';
import {useApp} from '../state/AppContext';
import {colors, radius, spacing, typography} from '../theme/theme';
import type {PublicSystemInfo} from '../api/types';

type Step = 'server' | 'credentials';

/** How often to ask the server whether the Quick Connect code was approved. */
const QUICK_CONNECT_POLL_MS = 3000;

/**
 * Pre-session onboarding: point the app at a server, then sign in.
 *
 * Quick Connect is offered first when the server supports it, because entering
 * a password with a directional remote is genuinely unpleasant.
 */
export const ConnectScreen = () => {
  const {identity, signIn} = useApp();
  const [step, setStep] = useState<Step>('server');
  const [address, setAddress] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [serverInfo, setServerInfo] = useState<PublicSystemInfo | undefined>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [quickConnectCode, setQuickConnectCode] = useState<string | undefined>();
  const [quickConnectAvailable, setQuickConnectAvailable] = useState(false);
  const quickConnectSecret = useRef<string | undefined>(undefined);

  const connect = useCallback(async () => {
    if (!identity) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const {serverUrl: url, info} = await probeServer(address, identity);
      setServerUrl(url);
      setServerInfo(info);
      setStep('credentials');

      // Pre-fill the user name when the server publishes exactly one user.
      try {
        const users = await getPublicUsers(url, identity);
        if (users?.length === 1) {
          setUsername(users[0].Name);
        }
      } catch {
        // Public users are optional; the manual field still works.
      }
      try {
        setQuickConnectAvailable(Boolean(await isQuickConnectEnabled(url, identity)));
      } catch {
        setQuickConnectAvailable(false);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [address, identity]);

  const signInWithPassword = useCallback(async () => {
    if (!identity || !serverInfo) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const session = await authenticateByName(
        serverUrl,
        identity,
        username.trim(),
        password,
        serverInfo,
      );
      await signIn(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [identity, password, serverInfo, serverUrl, signIn, username]);

  const startQuickConnect = useCallback(async () => {
    if (!identity) {
      return;
    }
    setError(undefined);
    try {
      const result = await initiateQuickConnect(serverUrl, identity);
      quickConnectSecret.current = result.Secret;
      setQuickConnectCode(result.Code);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [identity, serverUrl]);

  // Poll for approval only while a code is on screen.
  useEffect(() => {
    if (!quickConnectCode || !identity || !serverInfo) {
      return;
    }
    let cancelled = false;
    const timer = setInterval(async () => {
      const secret = quickConnectSecret.current;
      if (!secret) {
        return;
      }
      try {
        const state = await pollQuickConnect(serverUrl, identity, secret);
        if (cancelled || !state?.Authenticated) {
          return;
        }
        const session = await authenticateWithQuickConnect(
          serverUrl,
          identity,
          secret,
          serverInfo,
        );
        await signIn(session);
      } catch {
        // A rejected or expired code simply stops the flow; the user can
        // request a new one or fall back to the password fields.
      }
    }, QUICK_CONNECT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [identity, quickConnectCode, serverInfo, serverUrl, signIn]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <JellyfinLogo size={72} withWordmark />
        </View>

        {step === 'server' ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Connect to your server</Text>
            <Text style={styles.panelHint}>
              Enter the address of your Jellyfin server, for example 192.168.1.10 or
              https://jellyfin.example.com
            </Text>
            <LabelledInput
              autoFocus
              label="Server address"
              onChangeText={setAddress}
              onSubmit={connect}
              placeholder="192.168.1.10:8096"
              value={address}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              disabled={!address.trim()}
              label="Connect"
              loading={busy}
              onPress={connect}
              style={styles.action}
              variant="primary"
            />
          </View>
        ) : (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Sign in</Text>
            <Text style={styles.panelHint}>
              {serverInfo?.ServerName ?? 'Jellyfin'} · {serverUrl}
            </Text>

            {quickConnectCode ? (
              <View style={styles.quickConnectBox}>
                <Text style={styles.quickConnectLabel}>Quick Connect code</Text>
                <Text style={styles.quickConnectCode}>{quickConnectCode}</Text>
                <Text style={styles.panelHint}>
                  Enter this code in Jellyfin on another device, under Quick Connect.
                </Text>
              </View>
            ) : null}

            <LabelledInput
              autoFocus={!quickConnectCode}
              label="User name"
              onChangeText={setUsername}
              placeholder="User name"
              value={username}
            />
            <LabelledInput
              label="Password"
              onChangeText={setPassword}
              onSubmit={signInWithPassword}
              placeholder="Password"
              secure
              value={password}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actionRow}>
              <Button
                disabled={!username.trim()}
                label="Sign in"
                loading={busy}
                onPress={signInWithPassword}
                variant="primary"
              />
              {quickConnectAvailable && !quickConnectCode ? (
                <Button
                  label="Use Quick Connect"
                  onPress={startQuickConnect}
                  style={styles.actionSpacer}
                />
              ) : null}
              <Button
                label="Change server"
                onPress={() => {
                  setStep('server');
                  setError(undefined);
                  setQuickConnectCode(undefined);
                  quickConnectSecret.current = undefined;
                }}
                style={styles.actionSpacer}
                variant="ghost"
              />
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
};

interface InputProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  secure?: boolean;
  autoFocus?: boolean;
}

/**
 * A text field wrapped in the app's focus treatment.
 *
 * The wrapper draws the focus ring, because a bare `TextInput` gives almost no
 * indication of remote focus before the keyboard opens.
 */
const LabelledInput = ({
  label,
  value,
  onChangeText,
  onSubmit,
  placeholder,
  secure = false,
  autoFocus = false,
}: InputProps) => {
  const inputRef = useRef<TextInput>(null);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Focusable autoFocus={autoFocus} onPress={() => inputRef.current?.focus()}>
        {focused => (
          <View style={[styles.inputWrapper, focused && styles.inputWrapperFocused]}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onChangeText}
              onSubmitEditing={onSubmit}
              placeholder={placeholder}
              placeholderTextColor={colors.textTertiary}
              ref={inputRef}
              secureTextEntry={secure}
              style={styles.input}
              value={value}
            />
          </View>
        )}
      </Focusable>
    </View>
  );
};

const styles = StyleSheet.create({
  content: {alignItems: 'center', flexGrow: 1, justifyContent: 'center', padding: spacing.xxl},
  header: {marginBottom: spacing.xl},
  panel: {
    backgroundColor: colors.backgroundElevated,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    width: 760,
  },
  panelTitle: {...typography.title, marginBottom: spacing.xs},
  panelHint: {...typography.caption, marginBottom: spacing.lg},
  field: {marginBottom: spacing.md},
  fieldLabel: {...typography.caption, marginBottom: spacing.xs},
  inputWrapper: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  inputWrapperFocused: {
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.7,
    shadowRadius: 10,
  },
  input: {
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  error: {color: colors.danger, fontSize: 15, marginBottom: spacing.md},
  action: {marginTop: spacing.sm},
  actionRow: {flexDirection: 'row', marginTop: spacing.sm},
  actionSpacer: {marginLeft: spacing.md},
  quickConnectBox: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  quickConnectLabel: {...typography.caption, marginBottom: spacing.xs},
  quickConnectCode: {
    color: colors.accent,
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: 8,
    marginBottom: spacing.sm,
  },
});
