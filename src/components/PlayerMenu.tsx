import React, {useEffect} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView, useKeplerBackHandler} from '@amazon-devices/react-native-kepler';
import {Focusable} from './Focusable';
import {colors, radius, spacing, typography} from '../theme/theme';
import type {MediaStream} from '../api/types';

/** Which pane of the playback menu is showing. */
export type PlayerMenuState = 'closed' | 'root' | 'audio' | 'subtitles' | 'timing';

/** Step used by the subtitle timing adjustment, in seconds. */
const OFFSET_STEP = 0.5;
const OFFSET_LIMIT = 30;

interface Props {
  state: PlayerMenuState;
  setState: (state: PlayerMenuState) => void;
  onClose: () => void;
  audioTracks: MediaStream[];
  audioIndex?: number;
  onSelectAudio: (index: number) => void;
  subtitleTracks: MediaStream[];
  subtitleIndex?: number;
  onSelectSubtitle: (index: number | undefined) => void;
  subtitleOffset: number;
  onSubtitleOffsetChange: (offset: number) => void;
}

function trackLabel(track: MediaStream): string {
  if (track.DisplayTitle) {
    return track.DisplayTitle;
  }
  return [track.Language, track.Codec, track.Channels ? `${track.Channels}ch` : '']
    .filter(Boolean)
    .join(' · ') || `Track ${track.Index}`;
}

/**
 * The playback settings overlay: audio track, subtitle track, and subtitle
 * timing.
 *
 * Unlike the OSD this *does* contain focusable rows, because picking from a
 * list is what the D-pad is for. The player suspends its own key handling
 * while this is open so the two never compete for the arrow keys.
 */
export const PlayerMenu = ({
  state,
  setState,
  onClose,
  audioTracks,
  audioIndex,
  onSelectAudio,
  subtitleTracks,
  subtitleIndex,
  onSelectSubtitle,
  subtitleOffset,
  onSubtitleOffsetChange,
}: Props) => {
  const activeAudio = audioTracks.find(t => t.Index === audioIndex) ?? audioTracks[0];
  const activeSubtitle = subtitleTracks.find(t => t.Index === subtitleIndex);
  const backHandler = useKeplerBackHandler();

  // Back closes this overlay rather than leaving the player. Registering here
  // means the handler only exists while the menu is open, and it runs before
  // the router's, which would otherwise pop the whole screen.
  useEffect(() => {
    const subscription = backHandler.addEventListener('hardwareBackPress', () => {
      if (state === 'root') {
        onClose();
      } else {
        setState('root');
      }
      return true;
    });
    return () => subscription.remove();
  }, [backHandler, onClose, setState, state]);

  return (
    <View style={styles.backdrop}>
      <View style={styles.panel}>
        <Text style={styles.title}>
          {state === 'audio'
            ? 'Audio'
            : state === 'subtitles'
            ? 'Subtitles'
            : state === 'timing'
            ? 'Subtitle timing'
            : 'Playback settings'}
        </Text>

        <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight>
          <ScrollView contentContainerStyle={styles.list}>
            {state === 'root' ? (
              <>
                <Row
                  autoFocus
                  label="Audio"
                  onPress={() => setState('audio')}
                  value={activeAudio ? trackLabel(activeAudio) : 'None'}
                />
                <Row
                  label="Subtitles"
                  onPress={() => setState('subtitles')}
                  value={activeSubtitle ? trackLabel(activeSubtitle) : 'Off'}
                />
                <Row
                  disabled={!activeSubtitle}
                  label="Subtitle timing"
                  onPress={() => setState('timing')}
                  value={`${subtitleOffset > 0 ? '+' : ''}${subtitleOffset.toFixed(1)}s`}
                />
                <Row label="Close" onPress={onClose} />
              </>
            ) : null}

            {state === 'audio'
              ? audioTracks.map((track, index) => (
                  <Row
                    autoFocus={index === 0}
                    key={track.Index}
                    label={trackLabel(track)}
                    onPress={() => onSelectAudio(track.Index)}
                    selected={track.Index === activeAudio?.Index}
                  />
                ))
              : null}

            {state === 'subtitles' ? (
              <>
                <Row
                  autoFocus
                  label="Off"
                  onPress={() => onSelectSubtitle(undefined)}
                  selected={subtitleIndex === undefined}
                />
                {subtitleTracks.map(track => (
                  <Row
                    key={track.Index}
                    label={trackLabel(track)}
                    onPress={() => onSelectSubtitle(track.Index)}
                    selected={track.Index === subtitleIndex}
                  />
                ))}
              </>
            ) : null}

            {state === 'timing' ? (
              <>
                <Text style={styles.hint}>
                  Positive values show subtitles later; negative values show them earlier.
                </Text>
                <View style={styles.timingRow}>
                  <Focusable
                    autoFocus
                    onPress={() =>
                      onSubtitleOffsetChange(
                        Math.max(-OFFSET_LIMIT, subtitleOffset - OFFSET_STEP),
                      )
                    }>
                    {focused => (
                      <View style={[styles.stepper, focused && styles.stepperFocused]}>
                        <Text style={[styles.stepperText, focused && styles.rowLabelFocused]}>
                          −{OFFSET_STEP}s
                        </Text>
                      </View>
                    )}
                  </Focusable>
                  <Text style={styles.offsetValue}>
                    {subtitleOffset > 0 ? '+' : ''}
                    {subtitleOffset.toFixed(1)}s
                  </Text>
                  <Focusable
                    onPress={() =>
                      onSubtitleOffsetChange(
                        Math.min(OFFSET_LIMIT, subtitleOffset + OFFSET_STEP),
                      )
                    }>
                    {focused => (
                      <View style={[styles.stepper, focused && styles.stepperFocused]}>
                        <Text style={[styles.stepperText, focused && styles.rowLabelFocused]}>
                          +{OFFSET_STEP}s
                        </Text>
                      </View>
                    )}
                  </Focusable>
                </View>
                <Row label="Reset" onPress={() => onSubtitleOffsetChange(0)} />
              </>
            ) : null}

            {state !== 'root' ? <Row label="Back" onPress={() => setState('root')} /> : null}
          </ScrollView>
        </TVFocusGuideView>
      </View>
    </View>
  );
};

interface RowProps {
  label: string;
  value?: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

const Row = ({label, value, onPress, selected, disabled, autoFocus}: RowProps) => (
  <Focusable autoFocus={autoFocus} disabled={disabled} onPress={onPress}>
    {focused => (
      <View style={[styles.row, focused && styles.rowFocused, disabled && styles.rowDisabled]}>
        <Text style={[styles.rowLabel, focused && styles.rowLabelFocused]} numberOfLines={1}>
          {selected ? '● ' : ''}
          {label}
        </Text>
        {value ? (
          <Text style={[styles.rowValue, focused && styles.rowLabelFocused]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
    )}
  </Focusable>
);

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
  },
  panel: {
    backgroundColor: colors.backgroundElevated,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginRight: spacing.xxl,
    maxHeight: '80%',
    padding: spacing.lg,
    width: 620,
  },
  title: {...typography.sectionTitle, marginBottom: spacing.md},
  list: {paddingBottom: spacing.sm},
  hint: {...typography.caption, marginBottom: spacing.md},
  row: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowFocused: {backgroundColor: colors.text},
  rowDisabled: {opacity: 0.4},
  rowLabel: {color: colors.text, flexShrink: 1, fontSize: 18},
  rowLabelFocused: {color: colors.background},
  rowValue: {color: colors.textTertiary, fontSize: 16, marginLeft: spacing.md},
  timingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  stepper: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  stepperFocused: {backgroundColor: colors.text},
  stepperText: {color: colors.text, fontSize: 18, fontWeight: '600'},
  offsetValue: {
    color: colors.accent,
    fontSize: 26,
    fontWeight: '700',
    marginHorizontal: spacing.lg,
    minWidth: 110,
    textAlign: 'center',
  },
});
