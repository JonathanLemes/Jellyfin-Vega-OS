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
 * Vega OS 1.2 will not open a media URL directly — `set_src_uri` is rejected
 * before any decoding is attempted — so the manifest is parsed here, segments
 * are fetched in JavaScript, and the bytes are pushed into a `SourceBuffer`.
 * This is the only playback path the platform accepts.
 *
 * Only the video pipeline is used: Jellyfin muxes audio into the same
 * fragmented-MP4 segments, so a single `SourceBuffer` carries both. (Splitting
 * them across two `MediaSource`s is what the Moonlight port needed, because
 * there the two elementary streams arrived separately.)
 */

/** How many seconds to keep buffered ahead of the playhead. */
const BUFFER_AHEAD_SECONDS = 30;
/** How often to consider fetching the next segment. */
const PUMP_INTERVAL_MS = 500;
/** How close the playhead must land for a seek to count as done. */
const SEEK_TOLERANCE_SECONDS = 2;
/** Bounded so a stubborn element cannot leave the player retrying forever. */
const MAX_SEEK_ATTEMPTS = 40;

export interface HlsPlayerCallbacks {
  onError(message: string): void;
  onReady(durationSeconds: number): void;
  /** Fired when every segment has been appended. */
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
  /** Position the element should jump to once data is buffered there. */
  private pendingSeek?: number;
  private seekAttempts = 0;

  constructor(private readonly callbacks: HlsPlayerCallbacks) {}

  get element(): VideoPlayer {
    return this.player;
  }

  async initialize(): Promise<void> {
    await this.player.initialize();
  }

  /**
   * Attaches the render surface.
   *
   * The surface arrives from `KeplerVideoSurfaceView` after layout, which may
   * be before or after the stream is loaded, so both orderings are handled.
   */
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

  /**
   * Loads a master playlist and begins buffering.
   *
   * `maxBandwidth` caps variant selection so the client honours the same
   * ceiling it advertised to the server.
   */
  async load(masterUrl: string, maxBandwidth: number, startAtSeconds = 0): Promise<void> {
    // Every load gets a fresh MediaSource. Reusing one after a seek leaves the
    // old buffered timeline in place, and the element then waits forever for
    // data at a position the new stream never produces.
    this.stopPump();
    this.started = false;
    this.queue = undefined;
    this.mediaSource = new MediaSource();

    const masterText = await this.fetchText(masterUrl);
    const variants = parseMasterPlaylist(masterText);
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
    this.pendingSeek = startAtSeconds > 0 ? startAtSeconds : undefined;

    await this.attachMediaSource();
  }

  private attachMediaSource(): Promise<void> {
    return new Promise((resolve, reject) => {
      const playlist = this.playlist;
      const variant = this.variant;
      if (!playlist || !variant) {
        reject(new Error('The stream was not loaded.'));
        return;
      }

      this.mediaSource.onsourceopen = () => {
        try {
          const mime = mimeTypeFor(variant);
          const sourceBuffer = this.mediaSource.addSourceBuffer(mime);
          this.queue = new AppendQueue(sourceBuffer, this.callbacks.onError);
          this.mediaSource.duration = playlist.totalDurationSeconds;

          void this.appendInit().then(() => {
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

      // Attaching the MediaSource is what triggers `sourceopen`.
      this.player.src = URL.createObjectURL(this.mediaSource as never);
    });
  }

  private async appendInit(): Promise<void> {
    const playlist = this.playlist;
    if (!playlist?.initUri) {
      // Without an init segment the fragments have no moov and cannot decode.
      throw new Error('The stream is missing its initialisation segment.');
    }
    const bytes = await this.fetchBinary(resolveUri(this.playlistUrl, playlist.initUri));
    this.queue?.push(bytes);
  }

  /** Starts playback once both a surface and buffered data exist. */
  private maybeStart(): void {
    if (this.started || this.destroyed || !this.surfaceHandle || !this.queue) {
      return;
    }
    this.started = true;
    void this.player.play();
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

  /** Fetches the next segment when the buffer has drained below the target. */
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
      this.callbacks.onEnded();
      return;
    }

    const bufferedEnd = this.bufferedEnd();
    const position = this.pendingSeek ?? this.player.currentTime ?? 0;
    if (bufferedEnd - position > BUFFER_AHEAD_SECONDS) {
      return;
    }

    const segment = playlist.segments[this.nextSegment];
    this.nextSegment += 1;
    try {
      this.queue.push(await this.fetchBinary(resolveUri(this.playlistUrl, segment.uri)));
      this.applyPendingSeek();
    } catch (error) {
      // Rewind so the segment is retried on the next tick rather than leaving
      // a hole in the timeline.
      this.nextSegment -= 1;
      if (!this.destroyed) {
        this.callbacks.onError(`Could not load the stream: ${(error as Error)?.message}`);
      }
    }
  }

  private bufferedEnd(): number {
    try {
      const buffered = this.player.buffered;
      return buffered && buffered.length ? buffered.end(buffered.length - 1) : 0;
    } catch {
      return 0;
    }
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
   * Moves playback to `targetSeconds` within the loaded playlist.
   *
   * The HLS playlist always covers the whole item -- `StartTimeTicks` does not
   * shift it -- so seeking means dropping the buffer and resuming from the
   * segment that covers the target, then telling the element to jump there
   * once that data has actually landed.
   */
  seek(targetSeconds: number): void {
    const playlist = this.playlist;
    if (!playlist || !this.queue) {
      return;
    }
    const target = Math.max(0, Math.min(playlist.totalDurationSeconds - 1, targetSeconds));
    const index = this.segmentIndexFor(playlist, target);

    this.queue.clear();
    this.nextSegment = index;
    this.pendingSeek = target;
    this.seekAttempts = 0;
    this.startPump();
  }

  /**
   * Applies a queued seek once the buffer actually covers the target.
   *
   * Setting `currentTime` before the data is there is either ignored or leaves
   * the element stalled waiting for a range that does not exist yet.
   */
  private applyPendingSeek(): void {
    const target = this.pendingSeek;
    if (target === undefined) {
      return;
    }
    if (!this.bufferedCovers(target)) {
      return;
    }
    try {
      this.player.currentTime = target;
      this.pendingSeek = undefined;
    } catch {
      // Retried on the next fill.
    }
  }

  private bufferedCovers(seconds: number): boolean {
    try {
      const buffered = this.player.buffered;
      for (let i = 0; i < (buffered?.length ?? 0); i += 1) {
        if (seconds >= buffered.start(i) && seconds < buffered.end(i)) {
          return true;
        }
      }
    } catch {
      // Treated as not buffered.
    }
    return false;
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
