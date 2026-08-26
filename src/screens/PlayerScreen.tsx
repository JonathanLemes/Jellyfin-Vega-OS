import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler, type HWEvent} from '@amazon-devices/react-native-kepler';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {Gradient} from '../components/Gradient';
import {Screen} from '../components/Screen';
import {PlayerMenu, type PlayerMenuState} from '../components/PlayerMenu';
import {resolveStream} from '../api/jellyfin';
import {HlsVideoPlayer} from '../player/hlsVideoPlayer';
import {cueAt, parseVtt, type Cue} from '../player/subtitles';
import {useApi, useApp} from '../state/AppContext';
import {colors, radius, safeArea, spacing, typography} from '../theme/theme';
import {episodeLabel, formatClock, secondsToTicks, ticksToSeconds} from '../utils/format';
import type {BaseItemDto, MediaStream} from '../api/types';

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
const TICK_INTERVAL_MS = 250;

/**
 * Full-screen video playback with a Jellyfin-style on-screen display.
 *
 * Playback goes through `HlsVideoPlayer`, which feeds fragmented-MP4 segments
 * into Media Source Extensions: Vega OS will not open a media URL.
 *
 * Seeking and track changes both re-request the stream from the server at a new
 * offset rather than moving within the current one. Jellyfin transcodes a
 * session sequentially, so jumping to a segment it has not produced yet simply
 * hangs; asking for a new stream starting at the target is what the server is
 * built to serve. `streamStart` records where the current stream begins so the
 * OSD can still show an absolute position.
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
  const [menu, setMenu] = useState<PlayerMenuState>('closed');

  const [tracks, setTracks] = useState<MediaStream[]>([]);
  const [audioIndex, setAudioIndex] = useState<number | undefined>();
  const [subtitleIndex, setSubtitleIndex] = useState<number | undefined>();
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [cues, setCues] = useState<Cue[]>([]);
  const [caption, setCaption] = useState('');

  const osdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Mirrors for use inside intervals and unmount cleanup, which would
  // otherwise capture stale values.
  const positionRef = useRef(ticksToSeconds(startPositionTicks));
  const durationRef = useRef(0);
  const streamStart = useRef(0);
  const playMethodRef = useRef<string | undefined>(undefined);
  const mediaSourceRef = useRef<string | undefined>(undefined);
  const playSessionRef = useRef<string | undefined>(undefined);
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);
  // Rejects results from a stream request that a newer one has superseded.
  const loadToken = useRef(0);

  positionRef.current = position;
  durationRef.current = duration;

  const showOsd = useCallback(() => {
    setOsdVisible(true);
    if (osdTimer.current) {
      clearTimeout(osdTimer.current);
    }
    osdTimer.current = setTimeout(() => setOsdVisible(false), OSD_TIMEOUT_MS);
  }, []);

  /**
   * Asks the server for a stream starting at `atSeconds` and plays it.
   *
   * Used for the initial load, for every seek, and whenever the audio or
   * burned-in subtitle selection changes.
   */
  const openStream = useCallback(
    async (atSeconds: number, audio?: number, subtitle?: number) => {
      const player = playerRef.current;
      if (!player) {
        return;
      }
      const token = ++loadToken.current;
      setBuffering(true);
      setError(undefined);
      streamStart.current = atSeconds;
      setPosition(atSeconds);

      try {
        const info = await api.getPlaybackInfo(itemId, {
          profile: deviceProfile,
          startTimeTicks: secondsToTicks(atSeconds),
          mediaSourceId,
          audioStreamIndex: audio,
          subtitleStreamIndex: subtitle,
        });
        if (cancelledRef.current || token !== loadToken.current) {
          return;
        }
        const stream = resolveStream(api.session, itemId, info, mediaSourceId);
        playMethodRef.current = stream.playMethod;
        mediaSourceRef.current = stream.mediaSourceId;
        playSessionRef.current = stream.playSessionId;
        setTracks(stream.mediaStreams);
        // Adopt the server's defaults once, so the menu opens showing what is
        // actually playing rather than "None".
        setAudioIndex(current => current ?? stream.defaultAudioIndex);
        setSubtitleIndex(current =>
          current ?? (subtitle === undefined ? stream.defaultSubtitleIndex : subtitle),
        );

        if (stream.isDirect) {
          throw new Error('The server did not provide a stream this device can play.');
        }
        await player.load(stream.url, deviceProfile.MaxStreamingBitrate);
        if (cancelledRef.current || token !== loadToken.current) {
          return;
        }
        setBuffering(false);
        setPaused(false);
      } catch (err) {
        if (!cancelledRef.current && token === loadToken.current) {
          setError((err as Error).message);
          setBuffering(false);
        }
      }
    },
    [api, deviceProfile, itemId, mediaSourceId],
  );

  // --- Mount --------------------------------------------------------------

  useEffect(() => {
    cancelledRef.current = false;
    const player = new HlsVideoPlayer({
      onError: message => {
        if (!cancelledRef.current) {
          setError(message);
          setBuffering(false);
        }
      },
      onReady: () => setBuffering(false),
      onEnded: () => {
        if (!cancelledRef.current) {
          onExit();
        }
      },
    });
    playerRef.current = player;

    (async () => {
      try {
        await player.initialize();
        const detail = await api.getItem(itemId);
        if (cancelledRef.current) {
          return;
        }
        setItem(detail);
        setDuration(ticksToSeconds(detail.RunTimeTicks));
        await openStream(ticksToSeconds(startPositionTicks));
      } catch (err) {
        if (!cancelledRef.current) {
          setError((err as Error).message);
          setBuffering(false);
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
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

  // Polls the playhead: `timeupdate` is not delivered when rendering through a
  // detached surface on this platform.
  useEffect(() => {
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (player && !paused) {
        setPosition(streamStart.current + player.currentTime);
      }
    }, TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [paused]);

  // --- Tracks and subtitles ------------------------------------------------

  const subtitleTracks = useMemo(() => tracks.filter(t => t.Type === 'Subtitle'), [tracks]);
  const audioTracks = useMemo(() => tracks.filter(t => t.Type === 'Audio'), [tracks]);

  /**
   * Loads the selected subtitle track as WebVTT.
   *
   * Text tracks are rendered by the app, which is what makes the timing
   * adjustable. Picture-based tracks have no client renderer, so those are
   * burned in by the server and produce no cues here.
   */
  useEffect(() => {
    const track = subtitleTracks.find(t => t.Index === subtitleIndex);
    const source = mediaSourceRef.current;
    if (!track || !source || track.IsTextSubtitleStream === false) {
      setCues([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(api.subtitleUrl(itemId, source, track.Index));
        const text = response.ok ? await response.text() : '';
        if (!cancelled) {
          setCues(text ? parseVtt(text) : []);
        }
      } catch {
        if (!cancelled) {
          setCues([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, itemId, subtitleIndex, subtitleTracks]);

  useEffect(() => {
    setCaption(cues.length ? cueAt(cues, position, subtitleOffset)?.text ?? '' : '');
  }, [cues, position, subtitleOffset]);

  // --- Playback reporting -------------------------------------------------

  const reportBody = useCallback(
    (extra: Record<string, unknown> = {}) => ({
      ItemId: itemId,
      MediaSourceId: mediaSourceRef.current,
      PlaySessionId: playSessionRef.current,
      PlayMethod: playMethodRef.current,
      PositionTicks: secondsToTicks(positionRef.current),
      AudioStreamIndex: audioIndex,
      SubtitleStreamIndex: subtitleIndex,
      CanSeek: true,
      IsPaused: false,
      ...extra,
    }),
    [audioIndex, itemId, subtitleIndex],
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
      const limit = durationRef.current;
      const target = Math.max(
        0,
        Math.min(limit ? limit - 5 : Number.MAX_SAFE_INTEGER, positionRef.current + delta),
      );
      showOsd();
      void openStream(target, audioIndex, subtitleIndex);
    },
    [audioIndex, openStream, showOsd, subtitleIndex],
  );

  const selectAudio = useCallback(
    (index: number) => {
      setAudioIndex(index);
      setMenu('closed');
      void openStream(positionRef.current, index, subtitleIndex);
    },
    [openStream, subtitleIndex],
  );

  const selectSubtitle = useCallback(
    (index: number | undefined) => {
      setSubtitleIndex(index);
      setMenu('closed');
      const track = subtitleTracks.find(t => t.Index === index);
      // A picture-based track has to be burned in by the server, which needs a
      // new stream. A text track is fetched separately, so the video keeps
      // playing untouched.
      if (track && track.IsTextSubtitleStream === false) {
        void openStream(positionRef.current, audioIndex, index);
      }
    },
    [audioIndex, openStream, subtitleTracks],
  );

  useTVEventHandler((event: HWEvent) => {
    // Only act on key-down; Vega emits both down and up for every press.
    if (event.eventKeyAction !== undefined && event.eventKeyAction !== 0) {
      return;
    }
    // While the menu is open it owns the D-pad, so playback keys stand down.
    if (menu !== 'closed') {
      return;
    }
    switch (event.eventType) {
      case 'stop':
        onExit();
        break;
      // 'back' is intentionally not handled here: the router owns it, and
      // popping the route unmounts this screen, which stops playback.
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
        setMenu('root');
        break;
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

      {caption ? (
        <View style={styles.captionBox} pointerEvents="none">
          <Text style={styles.captionText}>{caption}</Text>
        </View>
      ) : null}

      {buffering ? (
        <View style={styles.bufferOverlay} pointerEvents="none">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : null}

      {menu !== 'closed' ? (
        <PlayerMenu
          audioIndex={audioIndex}
          audioTracks={audioTracks}
          onClose={() => setMenu('closed')}
          onSelectAudio={selectAudio}
          onSelectSubtitle={selectSubtitle}
          onSubtitleOffsetChange={setSubtitleOffset}
          setState={setMenu}
          state={menu}
          subtitleIndex={subtitleIndex}
          subtitleOffset={subtitleOffset}
          subtitleTracks={subtitleTracks}
        />
      ) : osdVisible ? (
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
                {'◀ ▶ seek · OK play/pause · ▲ audio & subtitles · Back to exit'}
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
  captionBox: {
    alignItems: 'center',
    bottom: 90,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  captionText: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 28,
    lineHeight: 38,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    textAlign: 'center',
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
  progressFill: {backgroundColor: colors.accent, borderRadius: radius.pill, height: '100%'},
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
