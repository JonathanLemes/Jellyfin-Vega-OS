import {JellyfinError, TICKS_PER_MS, buildQuery, normalizeServerUrl, request} from './client';
import {buildDeviceProfile, type DeviceProfile} from './deviceProfile';
import type {
  AuthenticationResult,
  BaseItemDto,
  DeviceIdentity,
  ItemsResponse,
  PlaybackInfoResponse,
  PublicSystemInfo,
  QuickConnectResult,
  Session,
} from './types';

/** Fields the browse screens need that Jellyfin omits from list responses by default. */
const LIST_FIELDS = [
  'PrimaryImageAspectRatio',
  'Overview',
  'ParentId',
  'MediaSourceCount',
];

const DETAIL_FIELDS = [
  'Overview',
  'Genres',
  'Studios',
  'People',
  'Taglines',
  'MediaSources',
  'MediaStreams',
  'Chapters',
  'ProviderIds',
  'OfficialRating',
  'PremiereDate',
];

const IMAGE_TYPES = ['Primary', 'Backdrop', 'Thumb', 'Logo'];

/**
 * Thin, typed wrapper around the Jellyfin HTTP API.
 *
 * One instance corresponds to one authenticated server/user pairing. The class
 * holds no UI state; screens own their own loading and error handling.
 */
export class JellyfinApi {
  constructor(readonly session: Session, readonly identity: DeviceIdentity) {}

  private call<T>(
    path: string,
    query?: Record<string, unknown>,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<T> {
    return request<T>(this.session.serverUrl, path, this.identity, {
      method,
      query: query as never,
      body,
      token: this.session.accessToken,
    });
  }

  /** Libraries visible to the signed-in user, in the server's configured order. */
  getViews(): Promise<ItemsResponse> {
    return this.call<ItemsResponse>('/UserViews', {userId: this.session.userId});
  }

  /** Partly-watched items, i.e. the "Continue Watching" shelf. */
  getResumable(limit = 16): Promise<ItemsResponse> {
    return this.call<ItemsResponse>('/UserItems/Resume', {
      userId: this.session.userId,
      limit,
      mediaTypes: 'Video',
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      enableTotalRecordCount: false,
    });
  }

  /** The next unwatched episode of each in-progress series. */
  getNextUp(limit = 16): Promise<ItemsResponse> {
    return this.call<ItemsResponse>('/Shows/NextUp', {
      userId: this.session.userId,
      limit,
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      enableTotalRecordCount: false,
      disableFirstEpisode: false,
    });
  }

  /** Recently added items within one library. */
  getLatest(parentId: string, limit = 16): Promise<BaseItemDto[]> {
    return this.call<BaseItemDto[]>('/Items/Latest', {
      userId: this.session.userId,
      parentId,
      limit,
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
    });
  }

  /** Paged item listing, used by the library grid and by search. */
  getItems(options: {
    parentId?: string;
    includeItemTypes?: string[];
    sortBy?: string[];
    sortOrder?: 'Ascending' | 'Descending';
    startIndex?: number;
    limit?: number;
    recursive?: boolean;
    searchTerm?: string;
    filters?: string[];
    genres?: string[];
  }): Promise<ItemsResponse> {
    return this.call<ItemsResponse>('/Items', {
      userId: this.session.userId,
      parentId: options.parentId,
      includeItemTypes: options.includeItemTypes,
      sortBy: options.sortBy ?? ['SortName'],
      sortOrder: options.sortOrder ?? 'Ascending',
      startIndex: options.startIndex ?? 0,
      limit: options.limit ?? 60,
      recursive: options.recursive ?? true,
      searchTerm: options.searchTerm,
      filters: options.filters,
      genres: options.genres,
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
    });
  }

  /** Full metadata for a single item. */
  getItem(itemId: string): Promise<BaseItemDto> {
    return this.call<BaseItemDto>(`/Items/${itemId}`, {
      userId: this.session.userId,
      fields: DETAIL_FIELDS,
    });
  }

  getSeasons(seriesId: string): Promise<ItemsResponse> {
    return this.call<ItemsResponse>(`/Shows/${seriesId}/Seasons`, {
      userId: this.session.userId,
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
    });
  }

  getEpisodes(seriesId: string, seasonId?: string): Promise<ItemsResponse> {
    return this.call<ItemsResponse>(`/Shows/${seriesId}/Episodes`, {
      userId: this.session.userId,
      seasonId,
      fields: [...LIST_FIELDS, 'Overview'],
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
    });
  }

  getSimilar(itemId: string, limit = 12): Promise<ItemsResponse> {
    return this.call<ItemsResponse>(`/Items/${itemId}/Similar`, {
      userId: this.session.userId,
      limit,
      fields: LIST_FIELDS,
    });
  }

  /**
   * Asks the server how this item can be played given the device profile.
   *
   * The answer drives the direct-play/transcode decision in `resolveStream`.
   */
  getPlaybackInfo(
    itemId: string,
    options: {
      profile: DeviceProfile;
      startTimeTicks?: number;
      mediaSourceId?: string;
      audioStreamIndex?: number;
      subtitleStreamIndex?: number;
      maxStreamingBitrate?: number;
    },
  ): Promise<PlaybackInfoResponse> {
    return this.call<PlaybackInfoResponse>(
      `/Items/${itemId}/PlaybackInfo`,
      {
        userId: this.session.userId,
        startTimeTicks: options.startTimeTicks,
        mediaSourceId: options.mediaSourceId,
        audioStreamIndex: options.audioStreamIndex,
        subtitleStreamIndex: options.subtitleStreamIndex,
        maxStreamingBitrate: options.maxStreamingBitrate ?? options.profile.MaxStreamingBitrate,
        // Direct play is deliberately refused. Vega OS will not open a media
        // URL, so playback goes through Media Source Extensions, and MSE can
        // only be fed fragmented MP4 -- which the server produces as HLS.
        // Stream copy stays enabled, so a compatible file is remuxed rather
        // than re-encoded and the server does very little work.
        enableDirectPlay: false,
        enableDirectStream: false,
        enableTranscoding: true,
        allowVideoStreamCopy: true,
        allowAudioStreamCopy: true,
      },
      'POST',
      {DeviceProfile: options.profile},
    );
  }

  /** Absolute URL for an external subtitle track. */
  subtitleUrl(itemId: string, mediaSourceId: string, streamIndex: number, format = 'vtt'): string {
    return `${this.session.serverUrl}/Videos/${itemId}/${mediaSourceId}/Subtitles/${streamIndex}/0/Stream.${format}${buildQuery(
      {api_key: this.session.accessToken},
    )}`;
  }

  // --- Playback reporting -------------------------------------------------
  // Jellyfin tracks watch state from these three calls. Without them the
  // server never learns what was watched and "Continue Watching" stays empty.

  reportPlaybackStart(body: Record<string, unknown>): Promise<void> {
    return this.call<void>('/Sessions/Playing', undefined, 'POST', body);
  }

  reportPlaybackProgress(body: Record<string, unknown>): Promise<void> {
    return this.call<void>('/Sessions/Playing/Progress', undefined, 'POST', body);
  }

  reportPlaybackStopped(body: Record<string, unknown>): Promise<void> {
    return this.call<void>('/Sessions/Playing/Stopped', undefined, 'POST', body);
  }

  /** Marks an item watched or unwatched. */
  setPlayed(itemId: string, played: boolean): Promise<void> {
    return this.call<void>(
      `/UserPlayedItems/${itemId}`,
      undefined,
      played ? 'POST' : 'DELETE',
    );
  }

  /** Adds or removes an item from the user's favourites. */
  setFavorite(itemId: string, favorite: boolean): Promise<void> {
    return this.call<void>(
      `/UserFavoriteItems/${itemId}`,
      undefined,
      favorite ? 'POST' : 'DELETE',
    );
  }

  /** Invalidates the access token server-side. */
  logout(): Promise<void> {
    return this.call<void>('/Sessions/Logout', undefined, 'POST');
  }
}

/** Confirms an address really is a Jellyfin server and returns its identity. */
export async function probeServer(
  rawUrl: string,
  identity: DeviceIdentity,
): Promise<{serverUrl: string; info: PublicSystemInfo}> {
  const serverUrl = normalizeServerUrl(rawUrl);
  const info = await request<PublicSystemInfo>(
    serverUrl,
    '/System/Info/Public',
    identity,
    {timeoutMs: 10000},
  );
  if (!info || !info.Version) {
    throw new JellyfinError(`${serverUrl} does not look like a Jellyfin server.`);
  }
  return {serverUrl, info};
}

/** Users the server offers on its login screen; may legitimately be empty. */
export function getPublicUsers(serverUrl: string, identity: DeviceIdentity) {
  return request<Array<{Id: string; Name: string; PrimaryImageTag?: string}>>(
    serverUrl,
    '/Users/Public',
    identity,
  );
}

export async function authenticateByName(
  serverUrl: string,
  identity: DeviceIdentity,
  username: string,
  password: string,
  serverInfo: PublicSystemInfo,
): Promise<Session> {
  const result = await request<AuthenticationResult>(
    serverUrl,
    '/Users/AuthenticateByName',
    identity,
    {method: 'POST', body: {Username: username, Pw: password}},
  );
  return toSession(serverUrl, identity, result, serverInfo);
}

// --- Quick Connect ------------------------------------------------------
// Lets the user approve this device from a phone or browser instead of typing
// a password with the remote, which is the friendlier path on a TV.

export function isQuickConnectEnabled(serverUrl: string, identity: DeviceIdentity) {
  return request<boolean>(serverUrl, '/QuickConnect/Enabled', identity);
}

export function initiateQuickConnect(serverUrl: string, identity: DeviceIdentity) {
  return request<QuickConnectResult>(serverUrl, '/QuickConnect/Initiate', identity, {
    method: 'POST',
  });
}

export function pollQuickConnect(
  serverUrl: string,
  identity: DeviceIdentity,
  secret: string,
) {
  return request<QuickConnectResult>(serverUrl, '/QuickConnect/Connect', identity, {
    query: {secret},
  });
}

export async function authenticateWithQuickConnect(
  serverUrl: string,
  identity: DeviceIdentity,
  secret: string,
  serverInfo: PublicSystemInfo,
): Promise<Session> {
  const result = await request<AuthenticationResult>(
    serverUrl,
    '/Users/AuthenticateWithQuickConnect',
    identity,
    {method: 'POST', body: {Secret: secret}},
  );
  return toSession(serverUrl, identity, result, serverInfo);
}

function toSession(
  serverUrl: string,
  identity: DeviceIdentity,
  result: AuthenticationResult,
  serverInfo: PublicSystemInfo,
): Session {
  if (!result?.AccessToken || !result?.User?.Id) {
    throw new JellyfinError('The server did not return a usable session.');
  }
  return {
    serverUrl,
    serverName: serverInfo.ServerName ?? 'Jellyfin',
    serverId: result.ServerId ?? serverInfo.Id ?? '',
    userId: result.User.Id,
    userName: result.User.Name,
    accessToken: result.AccessToken,
    deviceId: identity.deviceId,
  };
}

export interface ResolvedStream {
  url: string;
  /** True when the server handed back the original file untouched. */
  isDirect: boolean;
  mediaSourceId: string;
  playSessionId?: string;
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
  container?: string;
}

/**
 * Turns a `PlaybackInfo` answer into a URL the Vega player can open.
 *
 * Direct play is preferred because it avoids server-side CPU entirely; the
 * transcoding URL the server returns is relative and must be joined to the
 * server address.
 */
export function resolveStream(
  session: Session,
  itemId: string,
  info: PlaybackInfoResponse,
  mediaSourceId?: string,
): ResolvedStream {
  const source =
    (mediaSourceId && info.MediaSources?.find(s => s.Id === mediaSourceId)) ||
    info.MediaSources?.[0];
  if (!source) {
    throw new JellyfinError('The server did not offer a playable version of this item.');
  }

  if (source.TranscodingUrl) {
    // The server omits the token from `TranscodingUrl`, but the platform
    // player fetches the playlist itself and cannot attach an Authorization
    // header, so an untouched URL answers 401 and playback fails with a bare
    // decode error. Segments listed inside the manifest already carry the key.
    let path = source.TranscodingUrl;
    if (!/[?&]api_key=/.test(path)) {
      path += `${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(session.accessToken)}`;
    }
    // Force fragmented-MP4 segments. Jellyfin otherwise defaults to MPEG-TS,
    // which cannot be appended to a SourceBuffer; asking explicitly makes the
    // manifest carry an EXT-X-MAP init segment and `.mp4` fragments.
    if (!/[?&]SegmentContainer=/i.test(path)) {
      path += `&SegmentContainer=mp4`;
    }
    const url = `${session.serverUrl}${path}`;
    return {
      url,
      isDirect: false,
      mediaSourceId: source.Id,
      playSessionId: info.PlaySessionId,
      playMethod: 'Transcode',
      container: source.TranscodingContainer,
    };
  }

  const directUrl = `${session.serverUrl}/Videos/${itemId}/stream${buildQuery({
    static: true,
    mediaSourceId: source.Id,
    api_key: session.accessToken,
    playSessionId: info.PlaySessionId,
    Tag: source.ETag,
  })}`;
  return {
    url: directUrl,
    isDirect: true,
    mediaSourceId: source.Id,
    playSessionId: info.PlaySessionId,
    playMethod: source.SupportsDirectPlay ? 'DirectPlay' : 'DirectStream',
    container: source.Container,
  };
}

export {buildDeviceProfile, TICKS_PER_MS};
