import {authorizationHeader, buildQuery, normalizeServerUrl} from '../src/api/client';
import type {DeviceIdentity} from '../src/api/types';

describe('normalizeServerUrl', () => {
  it('adds the default scheme and port to a bare host', () => {
    expect(normalizeServerUrl('192.168.1.10')).toBe('http://192.168.1.10:8096');
  });

  it('keeps an explicit port', () => {
    expect(normalizeServerUrl('192.168.1.10:9000')).toBe('http://192.168.1.10:9000');
  });

  it('keeps an explicit scheme and does not add a port to it', () => {
    expect(normalizeServerUrl('https://jf.example.com')).toBe('https://jf.example.com');
  });

  it('strips trailing slashes', () => {
    expect(normalizeServerUrl('http://host:8096/')).toBe('http://host:8096');
  });

  it('does not append a port when a path is present', () => {
    expect(normalizeServerUrl('http://host/jellyfin')).toBe('http://host/jellyfin');
  });

  it('rejects an empty address', () => {
    expect(() => normalizeServerUrl('   ')).toThrow();
  });
});

describe('buildQuery', () => {
  it('returns an empty string when nothing is set', () => {
    expect(buildQuery({a: undefined, b: null, c: ''})).toBe('');
  });

  it('joins arrays with commas and encodes values', () => {
    expect(buildQuery({types: ['Movie', 'Series'], q: 'a b'})).toBe('?types=Movie%2CSeries&q=a%20b');
  });

  it('keeps false and zero, which are meaningful to Jellyfin', () => {
    expect(buildQuery({recursive: false, startIndex: 0})).toBe('?recursive=false&startIndex=0');
  });
});

describe('authorizationHeader', () => {
  const identity: DeviceIdentity = {
    client: 'Jellyfin Vega',
    device: 'Fire TV',
    deviceId: 'abc123',
    version: '0.1.0',
  };

  it('omits the token before authentication', () => {
    expect(authorizationHeader(identity)).toBe(
      'MediaBrowser Client="Jellyfin Vega", Device="Fire TV", DeviceId="abc123", Version="0.1.0"',
    );
  });

  it('includes the token once authenticated', () => {
    expect(authorizationHeader(identity, 'tok')).toContain('Token="tok"');
  });

  it('strips quotes that would break the header', () => {
    expect(authorizationHeader({...identity, device: 'My "TV"'})).toContain('Device="My TV"');
  });
});
