import {cueAt, parseVtt} from '../src/player/subtitles';

const VTT = `WEBVTT

NOTE this is a comment

1
00:00:01.000 --> 00:00:03.500
Hello there

2
00:00:04.000 --> 00:00:06.000 line:90%
<i>Second</i> line
with a wrap

00:01:00.000 --> 00:01:02.000
Later cue
`;

describe('parseVtt', () => {
  it('reads cues and ignores headers and comments', () => {
    const cues = parseVtt(VTT);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({startSeconds: 1, endSeconds: 3.5, text: 'Hello there'});
  });

  it('strips inline markup and keeps line breaks', () => {
    expect(parseVtt(VTT)[1].text).toBe('Second line\nwith a wrap');
  });

  it('ignores cue settings after the end timestamp', () => {
    expect(parseVtt(VTT)[1].endSeconds).toBe(6);
  });

  it('parses hour components', () => {
    expect(parseVtt(VTT)[2].startSeconds).toBe(60);
  });

  it('accepts comma decimal separators, as SRT-derived files use', () => {
    const cues = parseVtt('WEBVTT\n\n00:00:02,250 --> 00:00:03,000\nx\n');
    expect(cues[0].startSeconds).toBeCloseTo(2.25);
  });

  it('returns nothing for an empty file', () => {
    expect(parseVtt('WEBVTT\n')).toEqual([]);
  });
});

describe('cueAt', () => {
  const cues = parseVtt(VTT);

  it('finds the cue covering a position', () => {
    expect(cueAt(cues, 2)?.text).toBe('Hello there');
  });

  it('returns nothing between cues', () => {
    expect(cueAt(cues, 3.8)).toBeUndefined();
  });

  it('shifts lookup by a positive offset, showing subtitles later', () => {
    // The first cue spans 1-3.5s, so with +1s it displays over 2-4.5s.
    expect(cueAt(cues, 4.2, 1)?.text).toBe('Hello there');
    // ...and is no longer showing at 1.5s, where it would without an offset.
    expect(cueAt(cues, 1.5, 1)).toBeUndefined();
  });

  it('shifts lookup by a negative offset, showing subtitles earlier', () => {
    expect(cueAt(cues, 0.5, -1)?.text).toBe('Hello there');
  });

  it('handles a position past the last cue', () => {
    expect(cueAt(cues, 9999)).toBeUndefined();
  });
});
