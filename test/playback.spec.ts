import {resolveStream} from '../src/api/jellyfin';
import {buildDeviceProfile, probeCapabilities} from '../src/api/deviceProfile';
import {posterUrl, thumbUrl} from '../src/api/images';
import type {BaseItemDto, PlaybackInfoResponse, Session} from '../src/api/types';

const session: Session = {
  serverUrl: 'http://jf:8096',
  serverName: 'Test',
  serverId: 'sid',
  userId: 'uid',
  userName: 'user',
  accessToken: 'token',
  deviceId: 'dev',
};

describe('resolveStream', () => {
  it('uses the transcoding URL when the server supplies one', () => {
    const info: PlaybackInfoResponse = {
      PlaySessionId: 'ps',
      MediaSources: [{Id: 'ms1', TranscodingUrl: '/videos/1/master.m3u8?x=1'}],
    };
    const result = resolveStream(session, '1', info);
    expect(result.isDirect).toBe(false);
    expect(result.playMethod).toBe('Transcode');
    expect(result.url).toBe('http://jf:8096/videos/1/master.m3u8?x=1&api_key=token');
  });

  it('appends the token to the transcoding URL', () => {
    // The platform player cannot send an Authorization header, so a manifest
    // URL without api_key comes back 401 and playback fails.
    const info: PlaybackInfoResponse = {
      MediaSources: [{Id: 'ms1', TranscodingUrl: '/videos/1/master.m3u8?VideoCodec=h264'}],
    };
    expect(resolveStream(session, '1', info).url).toContain('api_key=token');
  });

  it('does not duplicate a token the server already included', () => {
    const info: PlaybackInfoResponse = {
      MediaSources: [{Id: 'ms1', TranscodingUrl: '/videos/1/master.m3u8?api_key=abc'}],
    };
    const url = resolveStream(session, '1', info).url;
    expect(url.match(/api_key=/g)).toHaveLength(1);
    expect(url).toContain('api_key=abc');
  });

  it('adds the token with a leading ? when the URL has no query', () => {
    const info: PlaybackInfoResponse = {
      MediaSources: [{Id: 'ms1', TranscodingUrl: '/videos/1/master.m3u8'}],
    };
    expect(resolveStream(session, '1', info).url).toBe(
      'http://jf:8096/videos/1/master.m3u8?api_key=token',
    );
  });

  it('builds an authenticated direct-play URL otherwise', () => {
    const info: PlaybackInfoResponse = {
      PlaySessionId: 'ps',
      MediaSources: [{Id: 'ms1', SupportsDirectPlay: true, Container: 'mkv'}],
    };
    const result = resolveStream(session, '1', info);
    expect(result.isDirect).toBe(true);
    expect(result.playMethod).toBe('DirectPlay');
    expect(result.url).toContain('/Videos/1/stream?');
    expect(result.url).toContain('static=true');
    expect(result.url).toContain('api_key=token');
    expect(result.url).toContain('mediaSourceId=ms1');
  });

  it('honours an explicitly requested media source', () => {
    const info: PlaybackInfoResponse = {
      MediaSources: [
        {Id: 'a', SupportsDirectPlay: true},
        {Id: 'b', SupportsDirectPlay: true},
      ],
    };
    expect(resolveStream(session, '1', info, 'b').mediaSourceId).toBe('b');
  });

  it('throws when the server offers nothing playable', () => {
    expect(() => resolveStream(session, '1', {MediaSources: []})).toThrow();
  });
});

describe('probeCapabilities', () => {
  it('falls back to a safe set when no probe is available', () => {
    const caps = probeCapabilities(undefined);
    expect(caps.videoCodecs).toContain('h264');
    expect(caps.audioCodecs).toContain('aac');
  });

  it('keeps only what the device reports it can decode', () => {
    const caps = probeCapabilities(mime =>
      mime.includes('avc1') || mime.includes('mp4a.40.2') ? 'probably' : '',
    );
    expect(caps.videoCodecs).toEqual(['h264']);
    expect(caps.audioCodecs).toEqual(['aac']);
  });

  it('does not return an empty list when the device answers no to everything', () => {
    const caps = probeCapabilities(() => '');
    expect(caps.videoCodecs.length).toBeGreaterThan(0);
    expect(caps.audioCodecs.length).toBeGreaterThan(0);
  });
});

describe('buildDeviceProfile', () => {
  it('advertises HLS transcoding as a fallback', () => {
    const profile = buildDeviceProfile();
    expect(profile.TranscodingProfiles.some(p => p.Protocol === 'hls')).toBe(true);
  });

  it('offers direct play for the containers Vega can demux', () => {
    const containers = buildDeviceProfile().DirectPlayProfiles.map(p => p.Container);
    expect(containers).toEqual(expect.arrayContaining(['mp4', 'mkv']));
  });

  it('drops HEVC from transcoding targets when the device lacks it', () => {
    const profile = buildDeviceProfile({
      canPlayType: mime => (mime.includes('avc1') || mime.includes('mp4a.40.2') ? 'probably' : ''),
    });
    const hls = profile.TranscodingProfiles.find(p => p.Container === 'mp4');
    expect(hls?.VideoCodec).toBe('h264');
  });
});

describe('image URLs', () => {
  it('uses the item primary image when present', () => {
    const item: BaseItemDto = {Id: 'i1', ImageTags: {Primary: 'tag1'}};
    expect(posterUrl(session.serverUrl, item)).toContain('/Items/i1/Images/Primary');
  });

  it('falls back to the series poster for an episode without art', () => {
    const item: BaseItemDto = {Id: 'e1', Type: 'Episode', SeriesId: 's1', SeriesPrimaryImageTag: 't'};
    expect(posterUrl(session.serverUrl, item)).toContain('/Items/s1/Images/Primary');
  });

  it('falls back to the parent backdrop for a wide episode still', () => {
    const item: BaseItemDto = {
      Id: 'e1',
      Type: 'Episode',
      ParentBackdropItemId: 's1',
      ParentBackdropImageTags: ['bt'],
    };
    expect(thumbUrl(session.serverUrl, item)).toContain('/Items/s1/Images/Backdrop/0');
  });

  it('returns undefined when there is no artwork at all', () => {
    expect(posterUrl(session.serverUrl, {Id: 'x'})).toBeUndefined();
  });
});
