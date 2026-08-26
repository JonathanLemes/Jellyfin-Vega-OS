/**
 * WebVTT parsing for client-rendered subtitles.
 *
 * Jellyfin can convert any text subtitle track to WebVTT, so the app fetches
 * one file and renders the cues itself. Doing the rendering here — rather than
 * asking the server to burn subtitles into the video — is what makes the
 * timing adjustable, since an offset is just added when looking a cue up.
 */

export interface Cue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

/** `HH:MM:SS.mmm` or `MM:SS.mmm` to seconds. */
function parseTimestamp(value: string): number {
  const parts = value.trim().split(':');
  if (parts.length < 2) {
    return 0;
  }
  const seconds = parseFloat(parts[parts.length - 1].replace(',', '.')) || 0;
  const minutes = parseInt(parts[parts.length - 2], 10) || 0;
  const hours = parts.length > 2 ? parseInt(parts[parts.length - 3], 10) || 0 : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

/** Strips the inline markup WebVTT allows, which has no meaning here. */
function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

export function parseVtt(input: string): Cue[] {
  const cues: Cue[] = [];
  // Blocks are separated by blank lines; a block may carry an optional id line
  // before its timing line.
  for (const block of input.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').filter(line => line.trim().length > 0);
    if (!lines.length) {
      continue;
    }
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex === -1) {
      continue; // Header ("WEBVTT"), NOTE, or STYLE block.
    }
    const [rawStart, rawEnd] = lines[timingIndex].split('-->');
    if (!rawStart || !rawEnd) {
      continue;
    }
    const text = stripTags(lines.slice(timingIndex + 1).join('\n'));
    if (!text) {
      continue;
    }
    cues.push({
      startSeconds: parseTimestamp(rawStart),
      // The end timestamp may be followed by cue settings; take the first token.
      endSeconds: parseTimestamp(rawEnd.trim().split(/\s+/)[0]),
      text,
    });
  }
  return cues.sort((a, b) => a.startSeconds - b.startSeconds);
}

/**
 * The cue visible at `positionSeconds`, shifted by `offsetSeconds`.
 *
 * A positive offset shows subtitles later, which is the direction a user asks
 * for when the text is running ahead of the speech.
 */
export function cueAt(
  cues: Cue[],
  positionSeconds: number,
  offsetSeconds = 0,
): Cue | undefined {
  const at = positionSeconds - offsetSeconds;
  // Cues are sorted and rarely overlap; a linear scan from a binary-searched
  // starting point keeps this cheap enough to run on every OSD tick.
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];
    if (at < cue.startSeconds) {
      high = mid - 1;
    } else if (at > cue.endSeconds) {
      low = mid + 1;
    } else {
      return cue;
    }
  }
  return undefined;
}
