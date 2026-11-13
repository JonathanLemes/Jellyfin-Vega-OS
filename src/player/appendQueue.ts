import {AppendMode, type SourceBuffer} from '@amazon-devices/react-native-w3cmedia';
import type {TimeRange} from './bufferPolicy';

/**
 * Serialises writes into a `SourceBuffer`.
 *
 * MSE rejects an `appendBuffer` or `remove` while a previous operation is still
 * updating, so every write queues behind `updateend`. Evictions share that
 * queue rather than jumping ahead of appends, which keeps the two from
 * cancelling each other out.
 *
 * A full buffer is not an error. `appendBuffer` throws `QuotaExceededError`
 * synchronously; the append is kept at the head of the queue, the queue blocks,
 * and the owner is asked to free space. Once it queues evictions the append is
 * retried. Previously the append was dropped, which left a hole in the timeline
 * that playback could never cross, and the message was surfaced as a fatal
 * playback error.
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

export interface AppendQueueCallbacks {
  /** The stream cannot be buffered at all; playback has to stop. */
  onError(message: string): void;
  /** The buffer is full. Expected to call `evictUrgently` when it can. */
  onQuotaExceeded(): void;
}

export class AppendQueue {
  private pending: Operation[] = [];
  private failed = false;
  private busy = false;
  private quotaBlocked = false;

  constructor(
    private readonly sourceBuffer: SourceBuffer,
    private readonly callbacks: AppendQueueCallbacks,
  ) {
    // Segments mode: each fragment is placed using the timestamps it carries.
    // Jellyfin writes absolute decode times (`-copyts`) -- segment 500 of a
    // six-second playlist really does report ~3000s -- so fragments land at
    // their true position with no offset arithmetic.
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
      this.callbacks.onError('The device rejected this stream format.');
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
   * Drops appends that have not started yet.
   *
   * Used when seeking, to discard segments queued for the old position. What is
   * already in the `SourceBuffer` is deliberately left alone: MSE handles
   * disjoint ranges, and removing the range under the playhead strands the
   * decoder with nothing to play. An append blocked on quota is dropped too:
   * it belongs to the old position.
   */
  dropQueued(): void {
    this.pending = this.pending.filter(op => op.kind !== 'append');
    this.quotaBlocked = false;
  }

  /** Queues removal of time ranges, used to bound memory use. */
  evict(ranges: TimeRange[]): void {
    if (this.failed || this.quotaBlocked) {
      return;
    }
    // One batch in flight is enough; the ranges are cheap to recompute later.
    if (this.pending.some(op => op.kind === 'evict')) {
      return;
    }
    this.pending.push(...ranges.map(r => ({kind: 'evict' as const, ...r})));
    this.flush();
  }

  /**
   * Frees space ahead of the append that hit the quota, then retries it.
   * Returns false when there was nothing to remove; the queue stays blocked
   * and the owner tries again once the playhead has moved on.
   */
  evictUrgently(ranges: TimeRange[]): boolean {
    if (this.failed || !ranges.length) {
      return false;
    }
    this.pending.unshift(...ranges.map(r => ({kind: 'evict' as const, ...r})));
    this.quotaBlocked = false;
    this.flush();
    return true;
  }

  get blocked(): boolean {
    return this.quotaBlocked;
  }

  get idle(): boolean {
    return (
      !this.pending.length && !this.busy && !this.quotaBlocked && !this.sourceBuffer.updating
    );
  }

  private flush(): void {
    if (
      this.failed ||
      this.quotaBlocked ||
      this.busy ||
      this.sourceBuffer.updating ||
      !this.pending.length
    ) {
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
      const name = String((error as Error)?.name ?? '');
      const message = String((error as Error)?.message ?? '');
      if (next.kind === 'evict') {
        // A failed eviction only costs memory; carry on with the rest.
        this.flush();
        return;
      }
      if (/quota/i.test(name) || /quota/i.test(message)) {
        this.pending.unshift(next);
        this.quotaBlocked = true;
        this.callbacks.onQuotaExceeded();
        return;
      }
      this.failed = true;
      this.pending = [];
      this.callbacks.onError(`The device could not buffer this stream: ${message}`);
    }
  }
}
