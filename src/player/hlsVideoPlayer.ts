import {MediaSource, VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {AppendQueue} from './appendQueue';
import {
  mimeTypeFor,
  parseMasterPlaylist,
  parseMediaPlaylist,
  resolveUri,
  selectVariant,
  type MediaPlaylist,
  type Variant,
} from './hlsPlaylist';

/**
 * Plays a Jellyfin fragmented-MP4 HLS stream through Media Source Extensions.
 *
 * Vega OS 1.2 will not open a media URL directly -- `set_src_uri` is rejected
 * before any decoding is attempted -- so the manifest is parsed here, segments
 * are fetched in JavaScript, and the bytes are pushed into a `SourceBuffer`.
 *
 * Seeking follows the shape MSE is designed for rather than trying to drive the
 * decoder by hand:
 *
 *   1. assign `currentTime`, which makes the element report `seeking` and wait;
 *   2. point the fetch loop at the segment covering the target;
 *   3. let the element resume by itself once data covering that position lands.
 *
 * In particular the buffer is *not* torn down on a seek. `SourceBuffer` copes
 * with disjoint ranges perfectly well, and removing the range under the
 * playhead is what previously left the pipeline stalled with no way back. Old
 * data is evicted lazily instead, only to stay within the memory budget.
 */

/** How many seconds to keep buffered ahead of the playhead. */
const BUFFER_AHEAD_SECONDS = 30;
/** Data further behind the playhead than this is dropped to bound memory. */
const BUFFER_BEHIND_SECONDS = 60;
/** How often to consider fetching the next segment. */
const PUMP_INTERVAL_MS = 250;

export interface HlsPlayerCallbacks {
  onError(message: string): void;
  onReady(durationSeconds: number): void;
  /** Playback position, straight from the element's own `timeupdate`. */
  onTime(positionSeconds: number): void;
  /** True while the element is waiting for data. */
  onBuffering(buffering: boolean): void;
  onEnded(): void;
}

export class HlsVideoPlayer {
  private readonly player = new VideoPlayer();
  private mediaSource = new MediaSource();
  private queue?: AppendQueue;
  private playlist?: MediaPlaylist;
  private variant?: Variant;
  private playlistUrl = '';
  private nextSegment = 0;
  private pump?: ReturnType<typeof setInterval>;
  private destroyed = false;
  private surfaceHandle?: string;
  private started = false;
  /** Generation counter; a seek invalidates fetches already in flight. */
  private epoch = 0;

  constructor(private readonly callbacks: HlsPlayerCallbacks) {}

  async initialize(): Promise<void> {
    await this.player.initialize();
    this.attachMediaEvents();
  }

  /**
   * Subscribes to the element's own events.
   *
   * These are the authoritative signals for buffering and position. Polling
   * `currentTime` cannot tell "waiting for data" apart from "paused", which is
   * what made the loading indicator unreliable.
   */
  private attachMediaEvents(): void {
    const on = (type: string, handler: () => void) => {
      try {
        this.player.addEventListener(type, handler as never);
      } catch {
        // A build without this event simply loses that signal.
      }
    };

    on('timeupdate', () => this.callbacks.onTime(this.player.currentTime ?? 0));
    on('seeking', () => this.callbacks.onBuffering(true));
    on('waiting', () => this.callbacks.onBuffering(true));
    on('stalled', () => this.callbacks.onBuffering(true));
    on('seeked', () => {
      this.callbacks.onTime(this.player.currentTime ?? 0);
      // A seek that happened while starved leaves the element stopped, so make
      // sure it is actually running again.
      void this.player.play();
    });
    on('playing', () => this.callbacks.onBuffering(false));
    on('canplay', () => this.callbacks.onBuffering(false));
    on('ended', () => this.callbacks.onEnded());
  }

  setSurface(handle: string): void {
    this.surfaceHandle = handle;
    if (!this.destroyed) {
      this.player.setSurfaceHandle(handle);
      this.maybeStart();
    }
  }

  clearSurface(handle: string): void {
    this.surfaceHandle = undefined;
    try {
      this.player.clearSurfaceHandle(handle);
    } catch {
      // The surface is already gone; nothing to release.
    }
  }

  async load(masterUrl: string, maxBandwidth: number, startAtSeconds = 0): Promise<void> {
    // A fresh MediaSource per load: reusing one leaves the previous timeline in
    // place and the element waits for data the new stream never produces.
    this.stopPump();
    this.started = false;
    this.queue = undefined;
    this.mediaSource = new MediaSource();
    this.epoch += 1;

    const variants = parseMasterPlaylist(await this.fetchText(masterUrl));
    const variant = selectVariant(variants, maxBandwidth);
    if (!variant) {
      throw new Error('The server did not offer a playable stream variant.');
    }
    this.variant = variant;
    this.playlistUrl = resolveUri(masterUrl, variant.uri);

    const playlist = parseMediaPlaylist(await this.fetchText(this.playlistUrl));
    if (!playlist.segments.length) {
      throw new Error('The stream contains no segments.');
    }
    this.playlist = playlist;
    this.nextSegment = this.segmentIndexFor(playlist, startAtSeconds);

    await this.attachMediaSource(startAtSeconds);
  }

  private attachMediaSource(startAtSeconds: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const playlist = this.playlist;
      const variant = this.variant;
      if (!playlist || !variant) {
        reject(new Error('The stream was not loaded.'));
        return;
      }

      this.mediaSource.onsourceopen = () => {
        try {
          const sourceBuffer = this.mediaSource.addSourceBuffer(mimeTypeFor(variant));
          this.queue = new AppendQueue(sourceBuffer, this.callbacks.onError);
          this.mediaSource.duration = playlist.totalDurationSeconds;

          void this.appendInit().then(() => {
            if (startAtSeconds > 0) {
              // Assigned before any media data: the element records the target
              // and waits, then starts there once the segment arrives.
              try {
                this.player.currentTime = startAtSeconds;
              } catch {
                // Non-fatal; playback simply begins at zero.
              }
            }
            this.callbacks.onReady(playlist.totalDurationSeconds);
            this.startPump();
            this.maybeStart();
            resolve();
          }, reject);
        } catch (error) {
          reject(
            new Error(
              `The device cannot decode this stream (${mimeTypeFor(variant)}): ${
                (error as Error)?.message
              }`,
            ),
          );
        }
      };

      this.player.src = URL.createObjectURL(this.mediaSource as never);
    });
  }

  private async appendInit(): Promise<void> {
    const playlist = this.playlist;
    if (!playlist?.initUri) {
      throw new Error('The stream is missing its initialisation segment.');
    }
    this.queue?.push(await this.fetchBinary(resolveUri(this.playlistUrl, playlist.initUri)));
  }

  private maybeStart(): void {
    if (this.started || this.destroyed || !this.surfaceHandle || !this.queue) {
      return;
    }
    this.started = true;
    void this.player.play();
  }

  private segmentIndexFor(playlist: MediaPlaylist, seconds: number): number {
    if (seconds <= 0) {
      return 0;
    }
    const index = playlist.segments.findIndex(
      s => seconds >= s.startSeconds && seconds < s.startSeconds + s.durationSeconds,
    );
    return index >= 0 ? index : Math.max(0, playlist.segments.length - 1);
  }

  /**
   * Moves playback to `targetSeconds`.
   *
   * Nothing is removed and nothing is waited for: the element is told where to
   * go, the fetch loop is aimed at the matching segment, and the element
   * resumes on its own once that data has been appended.
   */
  seek(targetSeconds: number): void {
    const playlist = this.playlist;
    if (!playlist) {
      return;
    }
    const target = Math.max(0, Math.min(playlist.totalDurationSeconds - 1, targetSeconds));

    // Fetches already in flight belong to the old position; discard them
    // rather than appending them ahead of the new one.
    this.epoch += 1;
    this.nextSegment = this.segmentIndexFor(playlist, target);
    this.queue?.dropQueued();

    try {
      this.player.currentTime = target;
    } catch {
      // The element rejects a seek before it has metadata; the pump appends on
      // the next tick and the assignment can be retried then.
    }
    this.startPump();
  }

  private startPump(): void {
    this.stopPump();
    this.pump = setInterval(() => void this.fill(), PUMP_INTERVAL_MS);
    void this.fill();
  }

  private stopPump(): void {
    if (this.pump) {
      clearInterval(this.pump);
      this.pump = undefined;
    }
  }

  /** Seconds of contiguous data ahead of `position`, or 0 if it is in a gap. */
  private bufferedAhead(position: number): number {
    try {
      const buffered = this.player.buffered;
      for (let i = 0; i < (buffered?.length ?? 0); i += 1) {
        // A small tolerance: a fragment rarely starts exactly on the second
        // that was asked for.
        if (position >= buffered.start(i) - 1 && position < buffered.end(i)) {
          return buffered.end(i) - position;
        }
      }
    } catch {
      // Unknown; treated as a gap so the caller fetches.
    }
    return 0;
  }

  private async fill(): Promise<void> {
    const playlist = this.playlist;
    if (this.destroyed || !playlist || !this.queue || !this.queue.idle) {
      return;
    }
    if (this.nextSegment >= playlist.segments.length) {
      this.stopPump();
      try {
        this.mediaSource.endOfStream();
      } catch {
        // Already ended.
      }
      return;
    }

    const position = this.player.currentTime ?? 0;
    // A gap under the playhead reports zero, so a seek always fetches at once.
    if (this.bufferedAhead(position) > BUFFER_AHEAD_SECONDS) {
      return;
    }

    const epoch = this.epoch;
    const segment = playlist.segments[this.nextSegment];
    this.nextSegment += 1;
    try {
      const bytes = await this.fetchBinary(resolveUri(this.playlistUrl, segment.uri));
      if (this.destroyed || epoch !== this.epoch) {
        return; // A seek happened while this was in flight.
      }
      this.queue.push(bytes);
      this.evictBehind(position);
    } catch (error) {
      if (epoch === this.epoch) {
        // Retry this segment rather than leaving a hole in the timeline.
        this.nextSegment -= 1;
      }
      if (!this.destroyed) {
        this.callbacks.onError(`Could not load the stream: ${(error as Error)?.message}`);
      }
    }
  }

  /**
   * Drops data well behind the playhead.
   *
   * A two-hour film would otherwise buffer far past what the device can hold,
   * and `appendBuffer` starts failing with a quota error.
   */
  private evictBehind(position: number): void {
    const cutoff = position - BUFFER_BEHIND_SECONDS;
    if (cutoff > 0) {
      this.queue?.evict(0, cutoff);
    }
  }

  play(): void {
    void this.player.play();
  }

  pause(): void {
    try {
      this.player.pause();
    } catch {
      // Pausing before the pipeline is ready is harmless.
    }
  }

  get currentTime(): number {
    return this.player.currentTime ?? 0;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.stopPump();
    if (this.surfaceHandle) {
      this.clearSurface(this.surfaceHandle);
    }
    try {
      this.player.pause();
    } catch {
      // Ignore: the player may never have started.
    }
    try {
      await this.player.deinitialize();
    } catch {
      // Ignore: releasing an uninitialised player is not an error.
    }
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`the server answered HTTP ${response.status}`);
    }
    return response.text();
  }

  private async fetchBinary(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`the server answered HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  }
}
