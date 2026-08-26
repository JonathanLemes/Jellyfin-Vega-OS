import React, {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button} from '../components/Button';
import {JellyfinLogo} from '../components/JellyfinLogo';
import {Screen} from '../components/Screen';
import {useApi, useApp} from '../state/AppContext';
import {APP_VERSION} from '../state/storage';
import {colors, radius, safeArea, spacing, typography} from '../theme/theme';

interface Props {
  onBack: () => void;
}

/**
 * Account and diagnostic information, plus sign-out.
 *
 * The decoder list is what the app told the server it can play, so it doubles
 * as a quick way to see why something is being transcoded.
 */
export const SettingsScreen = ({onBack}: Props) => {
  const {session, signOut, deviceProfile} = useApp();
  const api = useApi();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      // Best effort: the local session is cleared even if the server call
      // fails, otherwise a user on an unreachable server could never sign out.
      await api.logout().catch(() => undefined);
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }, [api, signOut]);

  const videoCodecs = deviceProfile.DirectPlayProfiles.find(p => p.Type === 'Video')?.VideoCodec;
  const audioCodecs = deviceProfile.DirectPlayProfiles.find(p => p.Type === 'Video')?.AudioCodec;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <JellyfinLogo size={54} withWordmark />
          <Text style={styles.version}>for Vega OS · {APP_VERSION}</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Account</Text>
          <Row label="Signed in as" value={session?.userName ?? '—'} />
          <Row label="Server" value={session?.serverName ?? '—'} />
          <Row label="Address" value={session?.serverUrl ?? '—'} />
          <Row label="Device ID" value={session?.deviceId ?? '—'} />
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Playback</Text>
          <Row
            label="Max streaming bitrate"
            value={`${Math.round(deviceProfile.MaxStreamingBitrate / 1_000_000)} Mbps`}
          />
          <Row label="Direct play video" value={videoCodecs ?? '—'} />
          <Row label="Direct play audio" value={audioCodecs ?? '—'} />
        </View>

        <View style={styles.actions}>
          <Button autoFocus label="Back" onPress={onBack} />
          <Button
            label="Sign out"
            loading={signingOut}
            onPress={handleSignOut}
            style={styles.signOut}
          />
        </View>
      </ScrollView>
    </Screen>
  );
};

const Row = ({label, value}: {label: string; value: string}) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} numberOfLines={2}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  content: {padding: safeArea.horizontal},
  header: {alignItems: 'center', flexDirection: 'row', marginBottom: spacing.xl},
  version: {...typography.caption, marginLeft: spacing.md},
  panel: {
    backgroundColor: colors.backgroundElevated,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  panelTitle: {...typography.sectionTitle, marginBottom: spacing.md},
  row: {flexDirection: 'row', marginBottom: spacing.sm},
  rowLabel: {...typography.caption, width: 260},
  rowValue: {...typography.body, flex: 1},
  actions: {flexDirection: 'row'},
  signOut: {marginLeft: spacing.md},
});
