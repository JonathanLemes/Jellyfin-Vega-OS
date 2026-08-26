/**
 * Minimal HLS playlist parsing.
 *
 * Only the subset Jellyfin emits for a VOD fragmented-MP4 stream is handled:
 * one `EXT-X-STREAM-INF` variant per master playlist, an `EXT-X-MAP`
 * initialisation segment, and a flat list of `EXTINF` segments. There is no
 * support for live playlists, discontinuities, or encryption, none of which
 * Jellyfin uses for this profile.
 */

export interface Variant {
  /** Playlist URI, relative to the master playlist. */
  uri: string;
  bandwidth: number;
  /** RFC 6381 codec string, e.g. `avc1.640028,mp4a.40.2`. */
  codecs?: string;
  resolution?: {width: number; height: number};
}

export interface Segment {
  uri: string;
  durationSeconds: number;
  /** Playback position where this segment starts. */
  startSeconds: number;
}

export interface MediaPlaylist {
  /** `EXT-X-MAP` initialisation segment; required for fragmented MP4. */
  initUri?: string;
  segments: Segment[];
  targetDurationSeconds: number;
  totalDurationSeconds: number;
}

function attributes(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Split on commas that are not inside quotes.
  const parts = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim().replace(/^"|"$/g, '');
    result[key] = value;
  }
  return result;
}

export function parseMasterPlaylist(text: string): Variant[] {
  const lines = text.split(/\r?\n/);
  const variants: Variant[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      continue;
    }
    const attrs = attributes(line.slice('#EXT-X-STREAM-INF:'.length));
    // The URI is on the next non-comment line.
    let uri = '';
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j].trim();
      if (candidate && !candidate.startsWith('#')) {
        uri = candidate;
        break;
      }
    }
    if (!uri) {
      continue;
    }
    const resolution = attrs.RESOLUTION?.match(/^(\d+)x(\d+)$/);
    variants.push({
      uri,
      bandwidth: Number(attrs.BANDWIDTH ?? attrs['AVERAGE-BANDWIDTH'] ?? 0),
      codecs: attrs.CODECS,
      resolution: resolution
        ? {width: Number(resolution[1]), height: Number(resolution[2])}
        : undefined,
    });
  }
  return variants;
}

export function parseMediaPlaylist(text: string): MediaPlaylist {
  const lines = text.split(/\r?\n/);
  const segments: Segment[] = [];
  let initUri: string | undefined;
  let targetDurationSeconds = 6;
  let pendingDuration = 0;
  let elapsed = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDurationSeconds = Number(line.slice('#EXT-X-TARGETDURATION:'.length)) || 6;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      initUri = attributes(line.slice('#EXT-X-MAP:'.length)).URI;
    } else if (line.startsWith('#EXTINF:')) {
      pendingDuration = parseFloat(line.slice('#EXTINF:'.length)) || 0;
    } else if (!line.startsWith('#')) {
      segments.push({uri: line, durationSeconds: pendingDuration, startSeconds: elapsed});
      elapsed += pendingDuration;
      pendingDuration = 0;
    }
  }

  return {initUri, segments, targetDurationSeconds, totalDurationSeconds: elapsed};
}

/**
 * Resolves a playlist-relative URI against the playlist it came from.
 *
 * Jellyfin's URIs are relative and carry their own query string, so the
 * base is everything up to the last path separator of the parent playlist.
 */
export function resolveUri(baseUrl: string, uri: string): string {
  if (/^https?:\/\//i.test(uri)) {
    return uri;
  }
  const withoutQuery = baseUrl.split('?')[0];
  const base = withoutQuery.slice(0, withoutQuery.lastIndexOf('/') + 1);
  return `${base}${uri}`;
}

/** Picks the highest-bandwidth variant that fits under the ceiling. */
export function selectVariant(variants: Variant[], maxBandwidth: number): Variant | undefined {
  if (!variants.length) {
    return undefined;
  }
  const affordable = variants
    .filter(v => !v.bandwidth || v.bandwidth <= maxBandwidth)
    .sort((a, b) => b.bandwidth - a.bandwidth);
  // Jellyfin reports BANDWIDTH=0 for some sources; those are still usable.
  return affordable[0] ?? variants.slice().sort((a, b) => a.bandwidth - b.bandwidth)[0];
}

/**
 * Builds the MSE MIME type for a variant.
 *
 * The codec string from the manifest must be passed through, otherwise the
 * platform cannot decide whether it can decode the stream and rejects the
 * `SourceBuffer` outright.
 */
export function mimeTypeFor(variant: Variant): string {
  return variant.codecs ? `video/mp4; codecs="${variant.codecs}"` : 'video/mp4';
}
