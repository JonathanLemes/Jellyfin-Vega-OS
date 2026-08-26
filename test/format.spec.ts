import {
  episodeLabel,
  formatClock,
  formatRuntime,
  formatYearRange,
  subtitleFor,
  ticksToSeconds,
  watchedFraction,
} from '../src/utils/format';
import type {BaseItemDto} from '../src/api/types';

const TICKS_PER_MINUTE = 600_000_000;

describe('formatRuntime', () => {
  it('renders hours and minutes', () => {
    expect(formatRuntime(107 * TICKS_PER_MINUTE)).toBe('1h 47m');
  });

  it('renders minutes only when under an hour', () => {
    expect(formatRuntime(23 * TICKS_PER_MINUTE)).toBe('23m');
  });

  it('returns an empty string for a missing runtime', () => {
    expect(formatRuntime(undefined)).toBe('');
  });
});

describe('formatClock', () => {
  it('omits the hour component for short positions', () => {
    expect(formatClock(247)).toBe('4:07');
  });

  it('zero-pads minutes once hours are shown', () => {
    expect(formatClock(3600 + 5 * 60 + 3)).toBe('1:05:03');
  });

  it('clamps negative and non-finite input', () => {
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
  });
});

describe('watchedFraction', () => {
  it('prefers the server-provided percentage', () => {
    expect(watchedFraction({Id: '1', UserData: {PlayedPercentage: 40}})).toBeCloseTo(0.4);
  });

  it('falls back to position over runtime', () => {
    const item: BaseItemDto = {
      Id: '1',
      RunTimeTicks: 100,
      UserData: {PlaybackPositionTicks: 25},
    };
    expect(watchedFraction(item)).toBeCloseTo(0.25);
  });

  it('is zero for an unwatched item', () => {
    expect(watchedFraction({Id: '1'})).toBe(0);
  });
});

describe('episodeLabel', () => {
  it('formats season and episode', () => {
    expect(episodeLabel({Id: '1', Type: 'Episode', ParentIndexNumber: 2, IndexNumber: 5})).toBe('S2:E5');
  });

  it('is empty for non-episodes', () => {
    expect(episodeLabel({Id: '1', Type: 'Movie', IndexNumber: 3})).toBe('');
  });
});

describe('subtitleFor', () => {
  it('shows series and numbering for an episode', () => {
    const item: BaseItemDto = {
      Id: '1',
      Type: 'Episode',
      SeriesName: 'Show',
      ParentIndexNumber: 1,
      IndexNumber: 2,
    };
    expect(subtitleFor(item)).toBe('Show · S1:E2');
  });

  it('shows the year for a movie', () => {
    expect(subtitleFor({Id: '1', Type: 'Movie', ProductionYear: 1999})).toBe('1999');
  });
});

describe('formatYearRange', () => {
  it('marks a running series as ongoing', () => {
    const item: BaseItemDto = {Id: '1', Type: 'Series', ProductionYear: 2015, Status: 'Continuing'};
    expect(formatYearRange(item)).toBe('2015 – present');
  });

  it('shows the closed range of an ended series', () => {
    const item: BaseItemDto = {
      Id: '1',
      Type: 'Series',
      ProductionYear: 2011,
      Status: 'Ended',
      EndDate: '2019-05-19T00:00:00.0000000Z',
    };
    expect(formatYearRange(item)).toBe('2011 – 2019');
  });
});

describe('ticksToSeconds', () => {
  it('converts Jellyfin ticks to seconds', () => {
    expect(ticksToSeconds(10_000_000)).toBe(1);
  });
});
