import {MediaSource, VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {AppendQueue} from './appendQueue';
import {bufferWindow, forwardBuffer, rangesToEvict, type TimeRange} from './bufferPolicy';
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

/** How often to consider fetching the next segment. */
const PUMP_INTERVAL_MS = 250;
/**
 * Initial guess at how much media the platform will hold. The real limit is
 * not exposed; when an append hits it, the budget shrinks to what was buffered
 * at that moment.
 */
const INITIAL_BUDGET_BYTES = 100 * 1024 * 1024;
const MIN_BUDGET_BYTES = 16 * 1024 * 1024;
/** Consecutive failed segment fetches tolerated before giving up. */
const MAX_FETCH_FAILURES = 5;
/** How long to wait before retrying a failed fetch. */
const FETCH_RETRY_MS = 1000;
/**
 * Once starved, playback is held until this much is buffered again. Resuming
 * as soon as one segment lands, as the element does by itself, turns a network
 * only slightly faster than the stream into a stutter every few seconds.
 */
const REBUFFER_GOAL_SECONDS = 12;

export interface HlsPlayerCallbacks {
  onError(message: string): void;
  onReady(durationSeconds: number): void;
  /** Playback position, straight from the element's own `timeupdate`. */
  onTime(positionSeconds: number): void;
  /** True while the element is waiting for data. */
  onBuffering(buffering: boolean): void;
  onEnded(): void;
  /** Optional trace of internal decisions, for on-device debugging. */
  onDiagnostic?(message: string): void;
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
  /** One segment request at a time; the pump ticks faster than a fetch. */
  private fetching = false;
  private abortFetch?: AbortController;
  private fetchFailures = 0;
  private retryAt = 0;
  private endOfStreamSignalled = false;
  /** Measured stream bitrate, smoothed across segments. */
  private bytesPerSecond = 0;
  /** Seconds of media downloaded per second of wall time, smoothed. */
  private downloadSpeed = 0;
  private budgetBytes = INITIAL_BUDGET_BYTES;
  private quotaHit = false;
  /** True between `seeking`/`waiting` and the element running again. */
  private waiting = false;
  /** True while playback is held back to rebuild the buffer. */
  private holding = false;
  private buffering = false;
  private userPaused = false;
  private lastTime = -1;

  constructor(private readonly callbacks: HlsPlayerCallbacks) {}

  async initialize(): Promise<void> {
    await this.player.initialize();
    this.attachMediaEvents();
  }

  private trace(message: string): void {
    this.callbacks.onDiagnostic?.(message);
  }

  private setWaiting(value: boolean): void {
    this.waiting = value;
    this.reportBuffering();
  }

  private reportBuffering(): void {
    const buffering = this.waiting || this.holding;
    if (this.buffering !== buffering) {
      this.buffering = buffering;
      this.callbacks.onBuffering(buffering);
    }
  }

  /**
   * Holds playback while starved until `REBUFFER_GOAL_SECONDS` are buffered, or
   * the rest of the stream is.
   */
  private manageRebuffer(ahead: number, aheadGoal: number, atEnd: boolean): void {
    // A connection with plenty of headroom refills faster than it drains, so
    // one segment is enough to resume on; holding longer only delays the start.
    const fast = this.downloadSpeed >= 2;
    const goal = fast
      ? this.playlist?.targetDurationSeconds ?? REBUFFER_GOAL_SECONDS
      : Math.min(REBUFFER_GOAL_SECONDS, aheadGoal);
    if (!this.holding && this.waiting && ahead < goal && !atEnd) {
      this.holding = true;
      this.trace(`hold ahead=${ahead.toFixed(1)}`);
      try {
        this.player.pause();
      } catch {
        // Not started yet; nothing to hold.
      }
      this.reportBuffering();
    } else if (this.holding && (ahead >= goal || atEnd)) {
      this.holding = false;
      this.trace(`resume ahead=${ahead.toFixed(1)}`);
      if (!this.userPaused) {
        void this.player.play();
      }
      this.reportBuffering();
    }
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

    on('timeupdate', () => {
      const time = this.player.currentTime ?? 0;
      // The clock moving is proof the element is not starved, even when the
      // platform skips the `playing` event after a seek.
      if (this.lastTime >= 0 && time > this.lastTime && !this.player.seeking) {
        this.setWaiting(false);
      }
      this.lastTime = time;
      this.callbacks.onTime(time);
    });
    on('seeking', () => this.setWaiting(true));
    on('waiting', () => this.setWaiting(true));
    on('seeked', () => {
      this.lastTime = this.player.currentTime ?? 0;
      this.callbacks.onTime(this.lastTime);
      this.setWaiting(false);
      // A seek that happened while starved leaves the element stopped, so make
      // sure it is actually running again -- unless the user paused it, or
      // the buffer is being rebuilt.
      if (!this.userPaused && !this.holding) {
        void this.player.play();
      }
    });
    on('playing', () => this.setWaiting(false));
    on('canplay', () => this.setWaiting(false));
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
    this.cancelFetch();
    this.started = false;
    this.queue = undefined;
    this.mediaSource = new MediaSource();
    this.epoch += 1;
    this.endOfStreamSignalled = false;
    this.fetchFailures = 0;
    this.quotaHit = false;
    this.lastTime = -1;
    this.holding = false;

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
        // `sourceopen` fires again when an append follows `endOfStream`;
        // only the first one sets the pipeline up.
        if (this.queue) {
          return;
        }
        try {
          const sourceBuffer = this.mediaSource.addSourceBuffer(mimeTypeFor(variant));
          this.queue = new AppendQueue(sourceBuffer, {
            onError: this.callbacks.onError,
            // Handled on the next pump tick rather than re-entrantly from
            // inside the failing append.
            onQuotaExceeded: () => {
              this.quotaHit = true;
            },
          });
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

  /** Largest hole in front of the playhead that is jumped over, in seconds. */
  private get maxGap(): number {
    return (this.playlist?.targetDurationSeconds ?? 6) + 1;
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

    // Fetches already in flight belong to the old position; abort them rather
    // than waiting for (and then discarding) a large segment.
    this.epoch += 1;
    this.cancelFetch();
    this.queue?.dropQueued();
    this.quotaHit = false;
    this.fetchFailures = 0;
    this.retryAt = 0;
    this.endOfStreamSignalled = false;

    // When the target is already buffered, continue from the end of that data
    // instead of downloading it again.
    const {ahead} = forwardBuffer(this.bufferedRanges(), target, this.maxGap);
    this.nextSegment = this.segmentIndexFor(playlist, ahead > 0 ? target + ahead : target);
    this.trace(`seek ${target.toFixed(1)} ahead=${ahead.toFixed(1)} next=${this.nextSegment}`);

    try {
      this.player.currentTime = target;
    } catch {
      // The element rejects a seek before it has metadata; the pump appends on
      // the next tick and playback begins wherever the data is.
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

  private cancelFetch(): void {
    try {
      this.abortFetch?.abort();
    } catch {
      // Nothing in flight.
    }
    this.abortFetch = undefined;
    this.fetching = false;
  }

  private bufferedRanges(): TimeRange[] {
    const ranges: TimeRange[] = [];
    try {
      const buffered = this.player.buffered;
      for (let i = 0; i < (buffered?.length ?? 0); i += 1) {
        ranges.push({start: buffered.start(i), end: buffered.end(i)});
      }
    } catch {
      // Unknown; treated as empty so the caller fetches.
    }
    return ranges;
  }

  /**
   * One tick of the buffer loop: recover from a full buffer, step over small
   * holes, trim memory, and fetch the next segment if the window has room.
   */
  private async fill(): Promise<void> {
    const playlist = this.playlist;
    const queue = this.queue;
    if (this.destroyed || !playlist || !queue) {
      return;
    }

    const position = this.player.currentTime ?? 0;
    const ranges = this.bufferedRanges();
    const window = bufferWindow(this.bytesPerSecond, this.budgetBytes);

    if (this.quotaHit || queue.blocked) {
      this.relieveQuota(ranges, position);
      return;
    }

    const {ahead, jumpTo} = forwardBuffer(ranges, position, this.maxGap);
    // The element will not cross a hole by itself. Holes appear when a seek
    // target falls just before the first keyframe the server could cut at,
    // and where two transcoder runs meet.
    if (jumpTo !== undefined && this.waiting) {
      this.trace(`gap ${position.toFixed(2)} -> ${jumpTo.toFixed(2)}`);
      try {
        this.player.currentTime = jumpTo + 0.05;
      } catch {
        // Retried next tick.
      }
    }

    this.manageRebuffer(
      ahead,
      window.ahead / 2,
      this.nextSegment >= playlist.segments.length && ahead > 0,
    );

    if (this.fetching || !queue.idle || Date.now() < this.retryAt) {
      return;
    }

    const evictions = rangesToEvict(ranges, position, window.behind, window.ahead + this.maxGap);
    if (evictions.length) {
      queue.evict(evictions);
      return;
    }

    if (this.nextSegment >= playlist.segments.length) {
      if (!this.endOfStreamSignalled) {
        this.endOfStreamSignalled = true;
        try {
          this.mediaSource.endOfStream();
        } catch {
          // Already ended.
        }
      }
      return;
    }

    if (ahead >= window.ahead) {
      return;
    }

    await this.fetchSegment(this.nextSegment);
  }

  private async fetchSegment(index: number): Promise<void> {
    const playlist = this.playlist;
    if (!playlist) {
      return;
    }
    const segment = playlist.segments[index];
    const epoch = this.epoch;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    this.abortFetch = controller;
    this.fetching = true;
    this.nextSegment = index + 1;
    const t0 = Date.now();
    try {
      const bytes = await this.fetchBinary(
        resolveUri(this.playlistUrl, segment.uri),
        controller?.signal,
      );
      if (this.destroyed || epoch !== this.epoch) {
        return; // A seek happened while this was in flight.
      }
      this.fetchFailures = 0;
      if (segment.durationSeconds > 0) {
        const rate = bytes.byteLength / segment.durationSeconds;
        this.bytesPerSecond = this.bytesPerSecond ? this.bytesPerSecond * 0.7 + rate * 0.3 : rate;
        const speed = segment.durationSeconds / Math.max(0.05, (Date.now() - t0) / 1000);
        this.downloadSpeed = this.downloadSpeed ? this.downloadSpeed * 0.7 + speed * 0.3 : speed;
      }
      this.queue?.push(bytes);
    } catch (error) {
      if (this.destroyed || epoch !== this.epoch) {
        return;
      }
      // Retry this segment rather than leaving a hole in the timeline. A
      // transcoder restarting after a seek can briefly answer with an error.
      this.nextSegment = index;
      this.fetchFailures += 1;
      this.retryAt = Date.now() + FETCH_RETRY_MS;
      this.trace(`fetch ${index} failed (${this.fetchFailures}): ${(error as Error)?.message}`);
      if (this.fetchFailures >= MAX_FETCH_FAILURES) {
        this.callbacks.onError(`Could not load the stream: ${(error as Error)?.message}`);
      }
    } finally {
      if (epoch === this.epoch) {
        this.fetching = false;
        this.abortFetch = undefined;
      }
    }
  }

  /**
   * Handles an append that did not fit.
   *
   * The budget shrinks to roughly what was held when the platform refused, and
   * everything outside the smaller window is removed before the append is
   * retried. When nothing can be removed yet the queue stays blocked and this
   * runs again on the next tick, by which time the playhead has moved on.
   */
  private relieveQuota(ranges: TimeRange[], position: number): void {
    const queue = this.queue;
    if (!queue) {
      return;
    }
    if (this.quotaHit) {
      this.quotaHit = false;
      const held = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
      const heldBytes = this.bytesPerSecond > 0 ? held * this.bytesPerSecond : this.budgetBytes;
      this.budgetBytes = Math.max(
        MIN_BUDGET_BYTES,
        Math.min(this.budgetBytes * 0.8, heldBytes * 0.8),
      );
      this.trace(
        `quota held=${held.toFixed(1)}s budget=${Math.round(this.budgetBytes / 1048576)}MB`,
      );
    }
    const window = bufferWindow(this.bytesPerSecond, this.budgetBytes);
    // While starved for space keep only a sliver behind the playhead.
    const evictions = rangesToEvict(ranges, position, 1, window.ahead + this.maxGap);
    if (queue.evictUrgently(evictions)) {
      this.trace(`quota evicted ${evictions.length} range(s)`);
    }
  }

  play(): void {
    this.userPaused = false;
    if (!this.holding) {
      void this.player.play();
    }
  }

  pause(): void {
    this.userPaused = true;
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
    this.cancelFetch();
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

  private async fetchBinary(url: string, signal?: AbortController['signal']): Promise<ArrayBuffer> {
    const response = await fetch(url, signal ? {signal} : undefined);
    if (!response.ok) {
      throw new Error(`the server answered HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  }
}
