import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler, type HWEvent} from '@amazon-devices/react-native-kepler';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {Gradient} from '../components/Gradient';
import {Screen} from '../components/Screen';
import {resolveStream} from '../api/jellyfin';
import {HlsVideoPlayer} from '../player/hlsVideoPlayer';
import {useApi, useApp} from '../state/AppContext';
import {colors, radius, safeArea, spacing, typography} from '../theme/theme';
import {episodeLabel, formatClock, secondsToTicks, ticksToSeconds} from '../utils/format';
import type {BaseItemDto} from '../api/types';

interface Props {
  itemId: string;
  startPositionTicks?: number;
  mediaSourceId?: string;
  onExit: () => void;
}

/** Seek step for the arrow keys and the dedicated skip keys, in seconds. */
const SEEK_SMALL = 10;
const SEEK_LARGE = 30;
/** How long the on-screen display stays up after the last key press. */
const OSD_TIMEOUT_MS = 4000;
/** Jellyfin expects a progress ping roughly every ten seconds. */
const PROGRESS_INTERVAL_MS = 10000;
/** How often the OSD re-reads the playhead. */
const TICK_INTERVAL_MS = 500;

/**
 * Full-screen video playback with a Jellyfin-style on-screen display.
 *
 * Playback goes through `HlsVideoPlayer`, which feeds fragmented-MP4 segments
 * into Media Source Extensions: Vega OS will not open a media URL directly.
 * The video is rendered into a `KeplerVideoSurfaceView` handed to the player.
 *
 * The OSD deliberately contains no focusable controls. Everything is driven
 * from remote key events, which avoids fighting the platform's spatial
 * navigation and matches how TV players are expected to behave.
 */
export const PlayerScreen = ({itemId, startPositionTicks = 0, mediaSourceId, onExit}: Props) => {
  const api = useApi();
  const {deviceProfile} = useApp();

  const playerRef = useRef<HlsVideoPlayer | undefined>(undefined);
  const [item, setItem] = useState<BaseItemDto | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [position, setPosition] = useState(ticksToSeconds(startPositionTicks));
  const [duration, setDuration] = useState(0);
  const [osdVisible, setOsdVisible] = useState(true);

  const osdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Mirrors for use inside intervals and unmount cleanup, which would
  // otherwise capture stale values.
  const positionRef = useRef(ticksToSeconds(startPositionTicks));
  const durationRef = useRef(0);
  const playMethodRef = useRef<string | undefined>(undefined);
  const mediaSourceRef = useRef<string | undefined>(undefined);
  const playSessionRef = useRef<string | undefined>(undefined);
  const startedRef = useRef(false);

  positionRef.current = position;
  durationRef.current = duration;

  const showOsd = useCallback(() => {
    setOsdVisible(true);
    if (osdTimer.current) {
      clearTimeout(osdTimer.current);
    }
    osdTimer.current = setTimeout(() => setOsdVisible(false), OSD_TIMEOUT_MS);
  }, []);

  // --- Load and start -----------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const player = new HlsVideoPlayer({
      onError: message => {
        if (!cancelled) {
          setError(message);
          setBuffering(false);
        }
      },
      onReady: total => {
        if (cancelled) {
          return;
        }
        setDuration(total);
        setBuffering(false);
        const resume = ticksToSeconds(startPositionTicks);
        if (resume > 1) {
          player.seek(resume);
        }
      },
      onEnded: () => {
        if (!cancelled) {
          onExit();
        }
      },
    });
    playerRef.current = player;

    (async () => {
      try {
        await player.initialize();
        const detail = await api.getItem(itemId);
        if (cancelled) {
          return;
        }
        setItem(detail);
        if (detail.RunTimeTicks) {
          setDuration(ticksToSeconds(detail.RunTimeTicks));
        }

        const info = await api.getPlaybackInfo(itemId, {
          profile: deviceProfile,
          mediaSourceId,
        });
        if (cancelled) {
          return;
        }
        const stream = resolveStream(api.session, itemId, info, mediaSourceId);
        playMethodRef.current = stream.playMethod;
        mediaSourceRef.current = stream.mediaSourceId;
        playSessionRef.current = stream.playSessionId;

        if (stream.isDirect) {
          // Direct play cannot be fed to MSE; the API layer asks the server
          // for a transcode, so this only happens if the server ignored that.
          throw new Error('The server did not provide a stream this device can play.');
        }
        await player.load(stream.url, deviceProfile.MaxStreamingBitrate);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setBuffering(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      void player.destroy();
      playerRef.current = undefined;
    };
    // Deliberately mounts once; a change of item remounts the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    showOsd();
    return () => {
      if (osdTimer.current) {
        clearTimeout(osdTimer.current);
      }
    };
  }, [showOsd]);

  // Polls the playhead: the element's timeupdate event is not delivered on
  // this platform when rendering through a detached surface.
  useEffect(() => {
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (player && !paused) {
        setPosition(player.currentTime);
      }
    }, TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [paused]);

  // --- Playback reporting -------------------------------------------------

  const reportBody = useCallback(
    (extra: Record<string, unknown> = {}) => ({
      ItemId: itemId,
      MediaSourceId: mediaSourceRef.current,
      PlaySessionId: playSessionRef.current,
      PlayMethod: playMethodRef.current,
      PositionTicks: secondsToTicks(positionRef.current),
      CanSeek: true,
      IsPaused: false,
      ...extra,
    }),
    [itemId],
  );

  useEffect(() => {
    if (startedRef.current || !duration) {
      return;
    }
    startedRef.current = true;
    api.reportPlaybackStart(reportBody()).catch(() => undefined);
  }, [api, duration, reportBody]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (startedRef.current) {
        api.reportPlaybackProgress(reportBody({IsPaused: paused})).catch(() => undefined);
      }
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [api, paused, reportBody]);

  // Reports the final position on the way out. Without this the server keeps
  // the session open and "Continue Watching" never updates.
  useEffect(
    () => () => {
      if (startedRef.current) {
        api.reportPlaybackStopped(reportBody()).catch(() => undefined);
      }
    },
    [api, reportBody],
  );

  // --- Controls -----------------------------------------------------------

  const togglePause = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    if (paused) {
      player.play();
      setPaused(false);
    } else {
      player.pause();
      setPaused(true);
    }
    showOsd();
  }, [paused, showOsd]);

  const seekBy = useCallback(
    (delta: number) => {
      const player = playerRef.current;
      if (!player) {
        return;
      }
      const limit = durationRef.current;
      const target = Math.max(0, Math.min(limit ? limit - 1 : Infinity, positionRef.current + delta));
      setPosition(target);
      setBuffering(true);
      player.seek(target);
      showOsd();
    },
    [showOsd],
  );

  useTVEventHandler((event: HWEvent) => {
    // Only act on key-down; Vega emits both down and up for every press.
    if (event.eventKeyAction !== undefined && event.eventKeyAction !== 0) {
      return;
    }
    switch (event.eventType) {
      case 'back':
      case 'stop':
        onExit();
        break;
      case 'playpause':
      case 'select':
      case 'pause':
        togglePause();
        break;
      case 'left':
        seekBy(-SEEK_SMALL);
        break;
      case 'right':
        seekBy(SEEK_SMALL);
        break;
      case 'skip_backward':
        seekBy(-SEEK_LARGE);
        break;
      case 'skip_forward':
        seekBy(SEEK_LARGE);
        break;
      case 'up':
      case 'down':
      case 'info':
        showOsd();
        break;
      default:
        break;
    }
  });

  const title = useMemo(() => {
    if (!item) {
      return '';
    }
    return item.Type === 'Episode' ? item.SeriesName ?? item.Name ?? '' : item.Name ?? '';
  }, [item]);

  const subtitle = useMemo(() => {
    if (!item) {
      return '';
    }
    return item.Type === 'Episode'
      ? [episodeLabel(item), item.Name].filter(Boolean).join(' · ')
      : '';
  }, [item]);

  if (error) {
    return (
      <Screen style={styles.black}>
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Playback failed</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <Text style={styles.errorHint}>Press Back to return.</Text>
        </View>
      </Screen>
    );
  }

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <Screen style={styles.black}>
      <KeplerVideoSurfaceView
        onSurfaceViewCreated={(handle: string) => playerRef.current?.setSurface(handle)}
        onSurfaceViewDestroyed={(handle: string) => playerRef.current?.clearSurface(handle)}
        style={StyleSheet.absoluteFill}
      />

      {buffering ? (
        <View style={styles.bufferOverlay} pointerEvents="none">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : null}

      {osdVisible ? (
        <View style={styles.osd} pointerEvents="none">
          <Gradient
            id="osdGradient"
            stops={[
              {color: '#000000', offset: 0, opacity: 0},
              {color: '#000000', offset: 0.55, opacity: 0.55},
              {color: '#000000', offset: 1, opacity: 0.92},
            ]}
          />
          <View style={styles.osdContent}>
            <Text style={styles.osdTitle} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.osdSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}

            <View style={styles.progressRow}>
              <Text style={styles.time}>{formatClock(position)}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, {width: `${progress * 100}%`}]} />
                <View style={[styles.progressKnob, {left: `${progress * 100}%`}]} />
              </View>
              <Text style={styles.time}>{formatClock(duration)}</Text>
            </View>

            <View style={styles.statusRow}>
              <Text style={styles.statusText}>{paused ? '❚❚ Paused' : '▶ Playing'}</Text>
              <Text style={styles.statusHint}>
                ◀ ▶ seek {SEEK_SMALL}s · OK play/pause · Back to exit
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  black: {backgroundColor: '#000000'},
  bufferOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  osd: {bottom: 0, height: 320, left: 0, position: 'absolute', right: 0},
  osdContent: {
    bottom: safeArea.vertical,
    left: safeArea.horizontal,
    position: 'absolute',
    right: safeArea.horizontal,
  },
  osdTitle: {...typography.title, fontSize: 34},
  osdSubtitle: {...typography.bodySecondary, marginTop: 2},
  progressRow: {alignItems: 'center', flexDirection: 'row', marginTop: spacing.md},
  time: {color: colors.text, fontSize: 16, minWidth: 84},
  progressTrack: {
    backgroundColor: colors.progressTrack,
    borderRadius: radius.pill,
    flex: 1,
    height: 6,
    justifyContent: 'center',
    marginHorizontal: spacing.md,
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    height: '100%',
  },
  progressKnob: {
    backgroundColor: colors.text,
    borderRadius: 9,
    height: 18,
    marginLeft: -9,
    position: 'absolute',
    width: 18,
  },
  statusRow: {alignItems: 'center', flexDirection: 'row', marginTop: spacing.sm},
  statusText: {color: colors.text, fontSize: 16, fontWeight: '600', minWidth: 130},
  statusHint: {color: colors.textTertiary, flex: 1, fontSize: 14},
  errorBox: {alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xxl},
  errorTitle: {...typography.title, marginBottom: spacing.sm},
  errorMessage: {...typography.bodySecondary, marginBottom: spacing.md, textAlign: 'center'},
  errorHint: {...typography.caption},
});
