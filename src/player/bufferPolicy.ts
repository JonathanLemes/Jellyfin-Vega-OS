/**
 * Pure decisions about what the MSE buffer should hold.
 *
 * Kept free of any player object so the arithmetic, which is where the seek and
 * memory bugs lived, can be unit tested.
 */

export interface TimeRange {
  start: number;
  end: number;
}

/** A fragment rarely starts exactly on the second that was asked for. */
const CONTAINS_TOLERANCE = 0.25;

export interface ForwardBuffer {
  /** Seconds of contiguous data from `position` onwards (0 when starved). */
  ahead: number;
  /**
   * Set when `position` sits in a small hole just before buffered data. The
   * element never crosses such a hole by itself, so the player has to move the
   * playhead to this time.
   */
  jumpTo?: number;
}

/**
 * Describes the data available at and after `position`.
 *
 * A gap shorter than `maxGap` in front of the playhead counts as buffered data:
 * with stream copy the server can only cut on keyframes, so the segment that
 * nominally covers a seek target often starts a second or two after it. Counting
 * that as a gap made the fetch loop download segment after segment, never
 * covering the target, until the device ran out of memory.
 */
export function forwardBuffer(
  ranges: TimeRange[],
  position: number,
  maxGap: number,
): ForwardBuffer {
  for (const range of ranges) {
    if (position >= range.start - CONTAINS_TOLERANCE && position < range.end) {
      return {ahead: range.end - position};
    }
  }
  let next: TimeRange | undefined;
  for (const range of ranges) {
    if (range.start > position && (!next || range.start < next.start)) {
      next = range;
    }
  }
  if (next && next.start - position <= maxGap) {
    return {ahead: next.end - position, jumpTo: next.start};
  }
  return {ahead: 0};
}

/**
 * Ranges to remove so the buffer only holds `[position - behind, position +
 * ahead]`.
 *
 * Both sides matter: seeking backwards leaves the data of the later position
 * stranded ahead of the playhead, and nothing would ever free it.
 */
export function rangesToEvict(
  ranges: TimeRange[],
  position: number,
  behind: number,
  ahead: number,
): TimeRange[] {
  const keepStart = position - behind;
  const keepEnd = position + ahead;
  const result: TimeRange[] = [];
  for (const range of ranges) {
    if (range.start < keepStart) {
      result.push({start: range.start, end: Math.min(range.end, keepStart)});
    }
    if (range.end > keepEnd) {
      result.push({start: Math.max(range.start, keepEnd), end: range.end});
    }
  }
  // Slivers are not worth an operation, and removing them can cut into the
  // fragment the decoder is reading.
  return result.filter(r => r.end - r.start >= 0.5);
}

export interface BufferWindow {
  /** Seconds to buffer ahead of the playhead before pausing the fetch loop. */
  ahead: number;
  /** Seconds kept behind the playhead for short backwards seeks. */
  behind: number;
}

export const WINDOW_LIMITS = {
  maxAhead: 30,
  minAhead: 8,
  maxBehind: 10,
  minBehind: 2,
};

/**
 * Sizes the buffer window from the stream's bitrate and a memory budget.
 *
 * A fixed window in seconds cannot work: stream copy of a 4K remux runs at
 * 50+ Mbps, where 90 seconds is over half a gigabyte.
 */
export function bufferWindow(bytesPerSecond: number, budgetBytes: number): BufferWindow {
  if (!(bytesPerSecond > 0)) {
    return {ahead: WINDOW_LIMITS.maxAhead, behind: WINDOW_LIMITS.maxBehind};
  }
  const seconds = budgetBytes / bytesPerSecond;
  const behind = clamp(seconds * 0.2, WINDOW_LIMITS.minBehind, WINDOW_LIMITS.maxBehind);
  const ahead = clamp(seconds - behind, WINDOW_LIMITS.minAhead, WINDOW_LIMITS.maxAhead);
  return {ahead, behind};
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
