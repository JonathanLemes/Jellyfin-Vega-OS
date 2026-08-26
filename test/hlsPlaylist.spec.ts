import {
  mimeTypeFor,
  parseMasterPlaylist,
  parseMediaPlaylist,
  resolveUri,
  selectVariant,
} from '../src/player/hlsPlaylist';

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=9740756,AVERAGE-BANDWIDTH=9740756,VIDEO-RANGE=SDR,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=23.976
main.m3u8?MediaSourceId=abc&api_key=tok
`;

const MEDIA = `#EXTM3U
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-MAP:URI="hls1/main/-1.mp4?api_key=tok"
#EXTINF:6.000000, nodesc
hls1/main/0.mp4?api_key=tok
#EXTINF:4.000000, nodesc
hls1/main/1.mp4?api_key=tok
#EXT-X-ENDLIST
`;

describe('parseMasterPlaylist', () => {
  it('reads the variant, its codecs and resolution', () => {
    const [variant] = parseMasterPlaylist(MASTER);
    expect(variant.uri).toBe('main.m3u8?MediaSourceId=abc&api_key=tok');
    expect(variant.bandwidth).toBe(9740756);
    // The CODECS value contains a comma, which must survive attribute parsing.
    expect(variant.codecs).toBe('avc1.640028,mp4a.40.2');
    expect(variant.resolution).toEqual({width: 1920, height: 1080});
  });

  it('returns nothing for a playlist with no variants', () => {
    expect(parseMasterPlaylist('#EXTM3U\n')).toEqual([]);
  });
});

describe('parseMediaPlaylist', () => {
  it('reads the init segment, segments and running start times', () => {
    const playlist = parseMediaPlaylist(MEDIA);
    expect(playlist.initUri).toBe('hls1/main/-1.mp4?api_key=tok');
    expect(playlist.segments).toHaveLength(2);
    expect(playlist.segments[0]).toMatchObject({startSeconds: 0, durationSeconds: 6});
    expect(playlist.segments[1]).toMatchObject({startSeconds: 6, durationSeconds: 4});
    expect(playlist.totalDurationSeconds).toBe(10);
    expect(playlist.targetDurationSeconds).toBe(6);
  });

  it('does not mistake tags for segment URIs', () => {
    expect(parseMediaPlaylist(MEDIA).segments.every(s => !s.uri.startsWith('#'))).toBe(true);
  });
});

describe('segment lookup for seeking', () => {
  // Mirrors HlsVideoPlayer.segmentIndexFor: seeking must resume from the
  // segment covering the target, not from the start of the playlist.
  const segments = parseMediaPlaylist(MEDIA).segments;
  const indexFor = (seconds: number) => {
    if (seconds <= 0) {
      return 0;
    }
    const i = segments.findIndex(
      s => seconds >= s.startSeconds && seconds < s.startSeconds + s.durationSeconds,
    );
    return i >= 0 ? i : Math.max(0, segments.length - 1);
  };

  it('resumes from the segment covering the target', () => {
    expect(indexFor(0)).toBe(0);
    expect(indexFor(5.9)).toBe(0);
    expect(indexFor(6)).toBe(1);
    expect(indexFor(9.9)).toBe(1);
  });

  it('clamps a target past the end to the last segment', () => {
    expect(indexFor(500)).toBe(1);
  });

  it('exposes the segment start used as the timeline offset', () => {
    expect(segments.map(s => s.startSeconds)).toEqual([0, 6]);
  });
});

describe('resolveUri', () => {
  it('resolves against the playlist directory, ignoring its query', () => {
    expect(resolveUri('http://s:8096/videos/1/main.m3u8?a=b', 'hls1/main/0.mp4?c=d')).toBe(
      'http://s:8096/videos/1/hls1/main/0.mp4?c=d',
    );
  });

  it('leaves absolute URIs alone', () => {
    expect(resolveUri('http://s/x/main.m3u8', 'http://other/seg.mp4')).toBe(
      'http://other/seg.mp4',
    );
  });
});

describe('selectVariant', () => {
  it('picks the highest bandwidth within the ceiling', () => {
    const variants = [
      {uri: 'a', bandwidth: 4_000_000},
      {uri: 'b', bandwidth: 12_000_000},
      {uri: 'c', bandwidth: 8_000_000},
    ];
    expect(selectVariant(variants, 10_000_000)?.uri).toBe('c');
  });

  it('still returns a variant when everything exceeds the ceiling', () => {
    const variants = [
      {uri: 'a', bandwidth: 20_000_000},
      {uri: 'b', bandwidth: 30_000_000},
    ];
    expect(selectVariant(variants, 1_000)?.uri).toBe('a');
  });

  it('accepts the zero-bandwidth variants Jellyfin sometimes reports', () => {
    expect(selectVariant([{uri: 'a', bandwidth: 0}], 1_000)?.uri).toBe('a');
  });
});

describe('mimeTypeFor', () => {
  it('carries the codec string through, which MSE requires', () => {
    expect(mimeTypeFor({uri: 'a', bandwidth: 1, codecs: 'avc1.640028,mp4a.40.2'})).toBe(
      'video/mp4; codecs="avc1.640028,mp4a.40.2"',
    );
  });

  it('falls back to a bare container type', () => {
    expect(mimeTypeFor({uri: 'a', bandwidth: 1})).toBe('video/mp4');
  });
});
