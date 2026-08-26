import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler, type HWEvent} from '@amazon-devices/react-native-kepler';
import {Video} from '@amazon-devices/react-native-w3cmedia';
import {Gradient} from '../components/Gradient';
import {Screen} from '../components/Screen';
import {resolveStream, type ResolvedStream} from '../api/jellyfin';
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

interface StreamState extends ResolvedStream {
  /** Absolute position, in seconds, that this stream begins at. */
  startSeconds: number;
}

/**
 * Full-screen video playback with a Jellyfin-style on-screen display.
 *
 * The OSD deliberately contains no focusable controls. Everything is driven
 * from remote key events, which avoids fighting the platform's spatial
 * navigation and matches how TV players are expected to behave.
 */
export const PlayerScreen = ({itemId, startPositionTicks = 0, mediaSourceId, onExit}: Props) => {
  const api = useApi();
  const {deviceProfile} = useApp();

  const videoRef = useRef<Video | null>(null);
  const [item, setItem] = useState<BaseItemDto | undefined>();
  const [stream, setStream] = useState<StreamState | undefined>();
  const [error, setError] = useState<string | undefined>();

  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  /** Position within the current stream, before adding `startSeconds`. */
  const [streamTime, setStreamTime] = useState(0);
  const [osdVisible, setOsdVisible] = useState(true);

  const osdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Mirrors of state for use inside intervals and unmount cleanup, which would
  // otherwise capture stale values.
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const streamRef = useRef<StreamState | undefined>(undefined);
  const startedRef = useRef(false);

  const runtimeSeconds = ticksToSeconds(item?.RunTimeTicks);
  const position = (stream?.startSeconds ?? 0) + streamTime;
  const duration = runtimeSeconds || durationRef.current;

  positionRef.current = position;
  streamRef.current = stream;

  const showOsd = useCallback(() => {
    setOsdVisible(true);
    if (osdTimer.current) {
      clearTimeout(osdTimer.current);
    }
    osdTimer.current = setTimeout(() => setOsdVisible(false), OSD_TIMEOUT_MS);
  }, []);

  /**
   * Asks the server how to play from `atSeconds` and swaps the stream in.
   *
   * Transcoded streams are re-requested at the new offset rather than sought
   * within, because the server generates them starting at the requested point.
   */
  const openStream = useCallback(
    async (atSeconds: number) => {
      setBuffering(true);
      setError(undefined);
      try {
        const detail = item ?? (await api.getItem(itemId));
        if (!item) {
          setItem(detail);
        }
        const info = await api.getPlaybackInfo(itemId, {
          profile: deviceProfile,
          startTimeTicks: secondsToTicks(atSeconds),
          mediaSourceId,
        });
        const resolved = resolveStream(api.session, itemId, info, mediaSourceId);
        // Direct play hands back the whole file, so its timeline starts at
        // zero and the resume point is applied by seeking instead.
        const startSeconds = resolved.isDirect ? 0 : atSeconds;
        setStream({...resolved, startSeconds});
        setStreamTime(resolved.isDirect ? atSeconds : 0);
      } catch (err) {
        setError((err as Error).message);
        setBuffering(false);
      }
    },
    [api, deviceProfile, item, itemId, mediaSourceId],
  );

  useEffect(() => {
    openStream(ticksToSeconds(startPositionTicks));
    // Intentionally run once: re-opening is driven explicitly by seeks.
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

  // --- Playback reporting -------------------------------------------------

  const reportBody = useCallback(
    (extra: Record<string, unknown> = {}) => ({
      ItemId: itemId,
      MediaSourceId: streamRef.current?.mediaSourceId,
      PlaySessionId: streamRef.current?.playSessionId,
      PlayMethod: streamRef.current?.playMethod,
      PositionTicks: secondsToTicks(positionRef.current),
      CanSeek: true,
      IsPaused: false,
      ...extra,
    }),
    [itemId],
  );

  useEffect(() => {
    if (!stream || startedRef.current) {
      return;
    }
    startedRef.current = true;
    api.reportPlaybackStart(reportBody()).catch(() => undefined);
  }, [api, reportBody, stream]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!startedRef.current) {
        return;
      }
      api.reportPlaybackProgress(reportBody({IsPaused: paused})).catch(() => undefined);
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
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (paused) {
      video.play();
      setPaused(false);
    } else {
      video.pause();
      setPaused(true);
    }
    showOsd();
  }, [paused, showOsd]);

  const seekBy = useCallback(
    (delta: number) => {
      const current = streamRef.current;
      if (!current) {
        return;
      }
      const limit = durationRef.current || runtimeSeconds;
      const target = Math.max(0, Math.min(limit ? limit - 1 : Infinity, positionRef.current + delta));
      showOsd();

      if (current.isDirect && videoRef.current) {
        videoRef.current.currentTime = target;
        setStreamTime(target);
      } else {
        openStream(target);
      }
    },
    [openStream, runtimeSeconds, showOsd],
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

  // --- Media element events ----------------------------------------------

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setStreamTime(video.currentTime ?? 0);
    }
  }, []);

  const onDurationChange = useCallback(() => {
    const video = videoRef.current;
    const value = video?.duration ?? 0;
    // A transcoded stream reports only its own remaining length; the item's
    // real runtime is the trustworthy total in that case.
    if (isFinite(value) && value > 0 && !runtimeSeconds) {
      durationRef.current = value;
    }
  }, [runtimeSeconds]);

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
      {stream ? (
        <Video
          autoplay
          controls={false}
          onCanPlay={() => setBuffering(false)}
          onDurationChange={onDurationChange}
          onEnded={onExit}
          onError={() => setError('The device could not play this stream.')}
          onPause={() => setPaused(true)}
          onPlay={() => setPaused(false)}
          onPlaying={() => setBuffering(false)}
          onTimeUpdate={onTimeUpdate}
          onWaiting={() => setBuffering(true)}
          ref={(ref: Video | null) => {
            videoRef.current = ref;
          }}
          scalingmode="fit"
          showCaptions
          src={stream.url}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

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
              {stream ? (
                <Text style={styles.statusBadge}>
                  {stream.isDirect ? 'Direct Play' : 'Transcoding'}
                </Text>
              ) : null}
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
  statusBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: radius.sm,
    color: colors.textSecondary,
    fontSize: 13,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  errorBox: {alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xxl},
  errorTitle: {...typography.title, marginBottom: spacing.sm},
  errorMessage: {...typography.bodySecondary, marginBottom: spacing.md, textAlign: 'center'},
  errorHint: {...typography.caption},
});
