import {AppendMode, type SourceBuffer} from '@amazon-devices/react-native-w3cmedia';

/**
 * Serialises appends into a `SourceBuffer`.
 *
 * MSE rejects an `appendBuffer` while a previous one is still updating, so
 * every write has to queue behind `updateend`. This also owns the `remove()`
 * used when seeking, for the same reason.
 */
export class AppendQueue {
  private pending: ArrayBuffer[] = [];
  private failed = false;
  private removing = false;

  constructor(
    private readonly sourceBuffer: SourceBuffer,
    private readonly onError: (message: string) => void,
  ) {
    // Segments mode: each fragment is placed using the timestamps it carries.
    // Jellyfin writes absolute decode times -- segment 500 of a six-second
    // playlist really does start at ~3000s -- so a fragment lands at its true
    // position without any offset arithmetic, which is what makes seeking by
    // segment index land where it should.
    try {
      this.sourceBuffer.mode = AppendMode.segments;
    } catch {
      // Some builds fix the mode once the buffer has data; the default is
      // already 'segments' for fragmented MP4.
    }
    this.sourceBuffer.onupdateend = () => {
      this.removing = false;
      this.flush();
    };
    this.sourceBuffer.onerror = () => {
      this.failed = true;
      this.pending = [];
      this.onError('The device rejected this stream format.');
    };
  }

  push(data: ArrayBuffer): void {
    if (this.failed) {
      return;
    }
    this.pending.push(data);
    this.flush();
  }

  /** Drops everything buffered; used before seeking to a new position. */
  clear(): void {
    this.pending = [];
    if (this.failed || this.sourceBuffer.updating) {
      return;
    }
    try {
      this.removing = true;
      this.sourceBuffer.remove(0, Number.POSITIVE_INFINITY);
    } catch {
      this.removing = false;
    }
  }

  get idle(): boolean {
    return !this.pending.length && !this.sourceBuffer.updating && !this.removing;
  }

  private flush(): void {
    if (this.failed || this.removing || this.sourceBuffer.updating || !this.pending.length) {
      return;
    }
    const next = this.pending.shift();
    if (!next) {
      return;
    }
    try {
      this.sourceBuffer.appendBuffer(next);
    } catch (error) {
      this.failed = true;
      this.pending = [];
      this.onError(`The device could not buffer this stream: ${(error as Error)?.message}`);
    }
  }
}
