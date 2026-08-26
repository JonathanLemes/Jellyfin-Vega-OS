import {AppendMode, type SourceBuffer} from '@amazon-devices/react-native-w3cmedia';

/**
 * Serialises writes into a `SourceBuffer`.
 *
 * MSE rejects an `appendBuffer` or `remove` while a previous operation is still
 * updating, so every write queues behind `updateend`. Evictions share that
 * queue rather than jumping ahead of appends, which keeps the two from
 * cancelling each other out.
 */

interface Append {
  kind: 'append';
  data: ArrayBuffer;
}

interface Eviction {
  kind: 'evict';
  start: number;
  end: number;
}

type Operation = Append | Eviction;

export class AppendQueue {
  private pending: Operation[] = [];
  private failed = false;
  private busy = false;

  constructor(
    private readonly sourceBuffer: SourceBuffer,
    private readonly onError: (message: string) => void,
  ) {
    // Segments mode: each fragment is placed using the timestamps it carries.
    // Jellyfin writes absolute decode times -- segment 500 of a six-second
    // playlist really does report ~3000s -- so fragments land at their true
    // position with no offset arithmetic.
    try {
      this.sourceBuffer.mode = AppendMode.segments;
    } catch {
      // Some builds fix the mode once the buffer has data; 'segments' is
      // already the default for fragmented MP4.
    }
    this.sourceBuffer.onupdateend = () => {
      this.busy = false;
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
    this.pending.push({kind: 'append', data});
    this.flush();
  }

  /**
   * Drops writes that have not started yet.
   *
   * Used when seeking, to discard segments queued for the old position. What is
   * already in the `SourceBuffer` is deliberately left alone: MSE handles
   * disjoint ranges, and removing the range under the playhead strands the
   * decoder with nothing to play.
   */
  dropQueued(): void {
    this.pending = this.pending.filter(op => op.kind !== 'append');
  }

  /** Queues removal of a time range, used to bound memory use. */
  evict(start: number, end: number): void {
    if (this.failed || end <= start) {
      return;
    }
    // One eviction in flight is enough; the range is cheap to recompute later.
    if (this.pending.some(op => op.kind === 'evict')) {
      return;
    }
    this.pending.push({kind: 'evict', start, end});
    this.flush();
  }

  get idle(): boolean {
    return !this.pending.length && !this.busy && !this.sourceBuffer.updating;
  }

  private flush(): void {
    if (this.failed || this.busy || this.sourceBuffer.updating || !this.pending.length) {
      return;
    }
    const next = this.pending.shift();
    if (!next) {
      return;
    }
    try {
      this.busy = true;
      if (next.kind === 'append') {
        this.sourceBuffer.appendBuffer(next.data);
      } else {
        this.sourceBuffer.remove(next.start, next.end);
      }
    } catch (error) {
      this.busy = false;
      const message = String((error as Error)?.message ?? '');
      if (next.kind === 'append' && /quota/i.test(message)) {
        // The buffer is full. Dropping this append is safe: the fetch loop
        // sees the gap and asks for the segment again once eviction frees room.
        this.onError('The device ran out of buffer space; freeing older data.');
        return;
      }
      this.failed = true;
      this.pending = [];
      this.onError(`The device could not buffer this stream: ${message}`);
    }
  }
}
