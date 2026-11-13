import type {MediaStream} from '../src/api/types';
import {
  isBurnedIn,
  needsNewStream,
  NO_SUBTITLE,
  streamBurnsSubtitles,
} from '../src/player/subtitleSelection';

const text: MediaStream = {Index: 2, Type: 'Subtitle', DeliveryMethod: 'External', IsTextSubtitleStream: true};
const pgs: MediaStream = {Index: 3, Type: 'Subtitle', DeliveryMethod: 'Encode', IsTextSubtitleStream: false};
const tracks = [text, pgs];

describe('subtitle selection', () => {
  it('knows which tracks are burned in', () => {
    expect(isBurnedIn(text)).toBe(false);
    expect(isBurnedIn(pgs)).toBe(true);
    expect(isBurnedIn({Index: 4, Type: 'Subtitle', IsTextSubtitleStream: false})).toBe(true);
    expect(isBurnedIn(undefined)).toBe(false);
  });

  it('switches text tracks without a new stream', () => {
    expect(needsNewStream(tracks, false, text.Index)).toBe(false);
    expect(needsNewStream(tracks, false, NO_SUBTITLE)).toBe(false);
  });

  it('needs a new stream to burn a track in', () => {
    expect(needsNewStream(tracks, false, pgs.Index)).toBe(true);
  });

  it('needs a new stream to get rid of a burned-in track', () => {
    expect(needsNewStream(tracks, true, text.Index)).toBe(true);
    expect(needsNewStream(tracks, true, NO_SUBTITLE)).toBe(true);
  });

  it('reads burn-in from the transcoding URL', () => {
    expect(streamBurnsSubtitles('/master.m3u8?SubtitleStreamIndex=3&SubtitleMethod=Encode&x=1')).toBe(true);
    expect(streamBurnsSubtitles('/master.m3u8?SubtitleMethod=Hls')).toBe(false);
  });
});
