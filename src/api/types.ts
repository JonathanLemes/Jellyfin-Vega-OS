/**
 * Subset of the Jellyfin API data-transfer objects used by this client.
 *
 * Jellyfin returns considerably more than this; only the fields the TV UI
 * actually reads are declared, so that a server change in an unrelated field
 * cannot break type checking here.
 */

/** Identity this client reports to the server; shown in Jellyfin's device list. */
export interface DeviceIdentity {
  client: string;
  device: string;
  deviceId: string;
  version: string;
}

export interface PublicSystemInfo {
  Id?: string;
  LocalAddress?: string;
  ServerName?: string;
  Version?: string;
  ProductName?: string;
  StartupWizardCompleted?: boolean;
}

export interface UserDto {
  Id: string;
  Name: string;
  PrimaryImageTag?: string;
  HasPassword?: boolean;
}

export interface AuthenticationResult {
  User: UserDto;
  AccessToken: string;
  ServerId: string;
}

export interface QuickConnectResult {
  Secret: string;
  Code: string;
  Authenticated?: boolean;
}

export interface UserItemData {
  PlaybackPositionTicks?: number;
  PlayCount?: number;
  IsFavorite?: boolean;
  Played?: boolean;
  PlayedPercentage?: number;
  UnplayedItemCount?: number;
}

export interface MediaStream {
  Index: number;
  Type: 'Audio' | 'Video' | 'Subtitle' | 'EmbeddedImage' | 'Data' | 'Lyric';
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  Height?: number;
  Width?: number;
  Channels?: number;
  DeliveryUrl?: string;
  IsTextSubtitleStream?: boolean;
}

export interface MediaSourceInfo {
  Id: string;
  Name?: string;
  Container?: string;
  Path?: string;
  Protocol?: string;
  Size?: number;
  Bitrate?: number;
  RunTimeTicks?: number;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  TranscodingUrl?: string;
  TranscodingSubProtocol?: string;
  TranscodingContainer?: string;
  MediaStreams?: MediaStream[];
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
  ETag?: string;
}

export interface PlaybackInfoResponse {
  MediaSources: MediaSourceInfo[];
  PlaySessionId?: string;
  ErrorCode?: string;
}

export interface NameGuidPair {
  Name?: string;
  Id?: string;
}

export interface BaseItemPerson {
  Id?: string;
  Name?: string;
  Role?: string;
  Type?: string;
  PrimaryImageTag?: string;
}

export interface ChapterInfo {
  StartPositionTicks?: number;
  Name?: string;
  ImageTag?: string;
}

/** The universal Jellyfin item: movie, series, season, episode, library view, ... */
export interface BaseItemDto {
  Id: string;
  Name?: string;
  OriginalTitle?: string;
  ServerId?: string;
  Type?: string;
  CollectionType?: string;
  MediaType?: string;
  Overview?: string;
  Taglines?: string[];
  ProductionYear?: number;
  PremiereDate?: string;
  EndDate?: string;
  OfficialRating?: string;
  CommunityRating?: number;
  CriticRating?: number;
  RunTimeTicks?: number;
  Genres?: string[];
  GenreItems?: NameGuidPair[];
  Studios?: NameGuidPair[];
  People?: BaseItemPerson[];
  Chapters?: ChapterInfo[];
  UserData?: UserItemData;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  ImageBlurHashes?: Record<string, Record<string, string>>;
  SeriesId?: string;
  SeriesName?: string;
  SeriesPrimaryImageTag?: string;
  SeasonId?: string;
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ChildCount?: number;
  RecursiveItemCount?: number;
  AlbumArtist?: string;
  Album?: string;
  AlbumId?: string;
  AlbumPrimaryImageTag?: string;
  MediaSources?: MediaSourceInfo[];
  MediaStreams?: MediaStream[];
  Status?: string;
  IsFolder?: boolean;
  LocationType?: string;
}

export interface ItemsResponse {
  Items: BaseItemDto[];
  TotalRecordCount?: number;
  StartIndex?: number;
}

/** A logged-in server + user pairing, persisted between app launches. */
export interface Session {
  serverUrl: string;
  serverName: string;
  serverId: string;
  userId: string;
  userName: string;
  accessToken: string;
  deviceId: string;
}
