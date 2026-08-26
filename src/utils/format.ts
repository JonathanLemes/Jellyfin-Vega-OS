import {TICKS_PER_SECOND} from '../api/client';
import type {BaseItemDto} from '../api/types';

export function ticksToSeconds(ticks?: number): number {
  return ticks ? ticks / TICKS_PER_SECOND : 0;
}

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

/** "1h 47m" / "23m" — the runtime format jellyfin-web shows on detail pages. */
export function formatRuntime(ticks?: number): string {
  const total = Math.round(ticksToSeconds(ticks) / 60);
  if (!total) {
    return '';
  }
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** "1:23:45" / "4:07" — clock format used by the player OSD. */
export function formatClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) {
    seconds = 0;
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hours ? String(minutes).padStart(2, '0') : String(minutes);
  return hours
    ? `${hours}:${mm}:${String(secs).padStart(2, '0')}`
    : `${mm}:${String(secs).padStart(2, '0')}`;
}

/** Fraction watched, 0..1, used for the progress bar under a poster. */
export function watchedFraction(item: BaseItemDto): number {
  const played = item.UserData?.PlayedPercentage;
  if (typeof played === 'number' && played > 0) {
    return Math.min(1, played / 100);
  }
  const position = item.UserData?.PlaybackPositionTicks ?? 0;
  const runtime = item.RunTimeTicks ?? 0;
  if (position > 0 && runtime > 0) {
    return Math.min(1, position / runtime);
  }
  return 0;
}

/** "S2:E5" prefix Jellyfin uses for episodes. */
export function episodeLabel(item: BaseItemDto): string {
  if (item.Type !== 'Episode') {
    return '';
  }
  const season = item.ParentIndexNumber;
  const episode = item.IndexNumber;
  if (season === undefined && episode === undefined) {
    return '';
  }
  if (season === undefined) {
    return `E${episode}`;
  }
  if (episode === undefined) {
    return `S${season}`;
  }
  return `S${season}:E${episode}`;
}

/**
 * The line shown under a tile's title.
 *
 * Episodes get their series and numbering; everything else gets its year,
 * matching what jellyfin-web puts in the card footer.
 */
export function subtitleFor(item: BaseItemDto): string {
  if (item.Type === 'Episode') {
    const label = episodeLabel(item);
    return [item.SeriesName, label].filter(Boolean).join(' · ');
  }
  if (item.Type === 'Season') {
    return item.SeriesName ?? '';
  }
  return item.ProductionYear ? String(item.ProductionYear) : '';
}

/** Title to show on a tile; episodes lead with the series name elsewhere. */
export function titleFor(item: BaseItemDto): string {
  return item.Name ?? 'Untitled';
}

export function formatYearRange(item: BaseItemDto): string {
  if (!item.ProductionYear) {
    return '';
  }
  if (item.Type !== 'Series') {
    return String(item.ProductionYear);
  }
  const ended = item.Status === 'Ended' && item.EndDate;
  const endYear = ended ? new Date(item.EndDate as string).getFullYear() : undefined;
  if (endYear && endYear !== item.ProductionYear) {
    return `${item.ProductionYear} – ${endYear}`;
  }
  return item.Status === 'Continuing'
    ? `${item.ProductionYear} – present`
    : String(item.ProductionYear);
}

export function formatRating(value?: number): string {
  return typeof value === 'number' ? value.toFixed(1) : '';
}
