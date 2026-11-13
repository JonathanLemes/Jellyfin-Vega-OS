import {bufferWindow, forwardBuffer, rangesToEvict, WINDOW_LIMITS} from '../src/player/bufferPolicy';

describe('forwardBuffer', () => {
  it('measures contiguous data from the playhead', () => {
    expect(forwardBuffer([{start: 0, end: 30}], 10, 7)).toEqual({ahead: 20});
  });

  it('treats a playhead just before a fragment as inside it', () => {
    expect(forwardBuffer([{start: 10.1, end: 16}], 10, 7).ahead).toBeCloseTo(6);
  });

  it('reports a small hole in front of the playhead as a jump target', () => {
    // A seek to 120 where the server could only cut at the keyframe at 122.4.
    expect(forwardBuffer([{start: 122.4, end: 128}], 120, 7)).toEqual({
      ahead: 8,
      jumpTo: 122.4,
    });
  });

  it('reports starvation when the next data is far away', () => {
    expect(forwardBuffer([{start: 0, end: 30}, {start: 300, end: 306}], 120, 7)).toEqual({
      ahead: 0,
    });
  });
});

describe('rangesToEvict', () => {
  it('trims data behind the playhead', () => {
    expect(rangesToEvict([{start: 0, end: 100}], 80, 10, 30)).toEqual([{start: 0, end: 70}]);
  });

  it('drops data stranded ahead by a backwards seek', () => {
    expect(
      rangesToEvict(
        [
          {start: 95, end: 130},
          {start: 1000, end: 1030},
        ],
        100,
        10,
        30,
      ),
    ).toEqual([{start: 1000, end: 1030}]);
  });

  it('ignores slivers', () => {
    expect(rangesToEvict([{start: 69.8, end: 90}], 80, 10, 30)).toEqual([]);
  });
});

describe('bufferWindow', () => {
  it('uses the full window before the bitrate is known', () => {
    expect(bufferWindow(0, 100e6)).toEqual({
      ahead: WINDOW_LIMITS.maxAhead,
      behind: WINDOW_LIMITS.maxBehind,
    });
  });

  it('shrinks the window for a high-bitrate remux', () => {
    // ~56 Mbps: a 4K Blu-ray remux copied straight through.
    const window = bufferWindow(7e6, 100 * 1024 * 1024);
    expect(window.ahead + window.behind).toBeLessThanOrEqual(16);
    expect(window.ahead).toBeGreaterThanOrEqual(WINDOW_LIMITS.minAhead);
  });
});
