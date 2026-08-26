import {AppendMode, MediaSource, VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
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
  async load(masterUrl: string, maxBandwidth: number): Promise<void> {
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
    this.nextSegment = 0;

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
          // "segments" mode: each fragment carries its own timestamps, which
          // is what makes seeking by segment index land in the right place.
          sourceBuffer.mode = AppendMode.segments;
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
    const position = this.player.currentTime ?? 0;
    if (bufferedEnd - position > BUFFER_AHEAD_SECONDS) {
      return;
    }

    const segment = playlist.segments[this.nextSegment];
    this.nextSegment += 1;
    try {
      this.queue.push(await this.fetchBinary(resolveUri(this.playlistUrl, segment.uri)));
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

  /**
   * Seeks by discarding the buffer and resuming from the segment covering the
   * target, which is exact because each fragment carries its own timestamps.
   */
  seek(targetSeconds: number): void {
    const playlist = this.playlist;
    if (!playlist || !this.queue) {
      return;
    }
    const clamped = Math.max(0, Math.min(playlist.totalDurationSeconds - 1, targetSeconds));
    let index = playlist.segments.findIndex(
      s => clamped >= s.startSeconds && clamped < s.startSeconds + s.durationSeconds,
    );
    if (index < 0) {
      index = playlist.segments.length - 1;
    }

    this.queue.clear();
    this.nextSegment = index;
    try {
      this.player.currentTime = playlist.segments[index].startSeconds;
    } catch {
      // The element rejects seeks before it has data; the pump will catch up.
    }
    // The init segment has to be re-sent after the buffer is emptied.
    void this.appendInit().catch(() => undefined);
    this.startPump();
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
