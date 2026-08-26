import {AppendMode, type SourceBuffer} from '@amazon-devices/react-native-w3cmedia';

interface PendingAppend {
  data: ArrayBuffer;
  /** Timeline position this buffer should land at, in seconds. */
  timestampOffset?: number;
}

/**
 * Serialises appends into a `SourceBuffer`.
 *
 * MSE rejects an `appendBuffer` while a previous one is still updating, so
 * every write has to queue behind `updateend`. `timestampOffset` has the same
 * restriction, which is why placing a buffer on the timeline belongs here
 * rather than at the call site.
 */
export class AppendQueue {
  private pending: PendingAppend[] = [];
  private failed = false;
  private removing = false;

  constructor(
    private readonly sourceBuffer: SourceBuffer,
    private readonly onError: (message: string) => void,
  ) {
    // Sequence mode lays each append immediately after the previous one and
    // ignores whatever timestamps the fragment carries internally. Jellyfin's
    // fragments start at zero whenever it restarts a transcode, so trusting
    // them would stack every segment on top of the first.
    try {
      this.sourceBuffer.mode = AppendMode.sequence;
    } catch {
      // Some builds fix the mode once a buffer has data; the explicit
      // timestampOffset below still places the run correctly.
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

  /**
   * Queues a buffer.
   *
   * `timestampOffset` is applied just before the append, and only needs to be
   * given for the first buffer of a run; sequence mode carries the timeline
   * forward from there.
   */
  push(data: ArrayBuffer, timestampOffset?: number): void {
    if (this.failed) {
      return;
    }
    this.pending.push({data, timestampOffset});
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
      if (next.timestampOffset !== undefined) {
        this.sourceBuffer.timestampOffset = next.timestampOffset;
      }
      this.sourceBuffer.appendBuffer(next.data);
    } catch (error) {
      this.failed = true;
      this.pending = [];
      this.onError(`The device could not buffer this stream: ${(error as Error)?.message}`);
    }
  }
}
