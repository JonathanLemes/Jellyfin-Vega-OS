import {buildQuery} from './client';
import type {BaseItemDto} from './types';

export type ImageType = 'Primary' | 'Backdrop' | 'Thumb' | 'Logo' | 'Banner';

interface ImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  tag?: string;
  index?: number;
}

/**
 * Builds a Jellyfin image URL.
 *
 * Image endpoints are unauthenticated, so no token is attached. Passing the
 * image tag matters: it is what lets the server (and the RN image cache) treat
 * updated artwork as a different URL instead of serving a stale picture.
 */
export function imageUrl(
  serverUrl: string,
  itemId: string,
  type: ImageType,
  options: ImageOptions = {},
): string {
  const {maxWidth, maxHeight, quality = 90, tag, index = 0} = options;
  const suffix = type === 'Backdrop' ? `/${index}` : '';
  return `${serverUrl}/Items/${itemId}/Images/${type}${suffix}${buildQuery({
    maxWidth,
    maxHeight,
    quality,
    tag,
  })}`;
}

/**
 * Poster art for an item, falling back to the parent series/album art.
 *
 * Episodes frequently have no primary image of their own; jellyfin-web shows
 * the series poster in that case, and so does this client.
 */
export function posterUrl(
  serverUrl: string,
  item: BaseItemDto,
  maxHeight = 480,
): string | undefined {
  const primaryTag = item.ImageTags?.Primary;
  if (primaryTag) {
    return imageUrl(serverUrl, item.Id, 'Primary', {maxHeight, tag: primaryTag});
  }
  if (item.SeriesPrimaryImageTag && item.SeriesId) {
    return imageUrl(serverUrl, item.SeriesId, 'Primary', {
      maxHeight,
      tag: item.SeriesPrimaryImageTag,
    });
  }
  if (item.AlbumPrimaryImageTag && item.AlbumId) {
    return imageUrl(serverUrl, item.AlbumId, 'Primary', {
      maxHeight,
      tag: item.AlbumPrimaryImageTag,
    });
  }
  return undefined;
}

/**
 * Wide artwork for an item, preferring a real thumb and falling back through
 * the item's own backdrop and then the parent's, which is what episodes need.
 */
export function thumbUrl(
  serverUrl: string,
  item: BaseItemDto,
  maxWidth = 640,
): string | undefined {
  const thumbTag = item.ImageTags?.Thumb;
  if (thumbTag) {
    return imageUrl(serverUrl, item.Id, 'Thumb', {maxWidth, tag: thumbTag});
  }
  const primaryTag = item.ImageTags?.Primary;
  if (primaryTag) {
    return imageUrl(serverUrl, item.Id, 'Primary', {maxWidth, tag: primaryTag});
  }
  if (item.BackdropImageTags?.length) {
    return imageUrl(serverUrl, item.Id, 'Backdrop', {
      maxWidth,
      tag: item.BackdropImageTags[0],
    });
  }
  if (item.ParentThumbItemId && item.ParentThumbImageTag) {
    return imageUrl(serverUrl, item.ParentThumbItemId, 'Thumb', {
      maxWidth,
      tag: item.ParentThumbImageTag,
    });
  }
  if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
    return imageUrl(serverUrl, item.ParentBackdropItemId, 'Backdrop', {
      maxWidth,
      tag: item.ParentBackdropImageTags[0],
    });
  }
  return undefined;
}

/** Full-bleed background art used behind the detail screen. */
export function backdropUrl(
  serverUrl: string,
  item: BaseItemDto,
  maxWidth = 1920,
): string | undefined {
  if (item.BackdropImageTags?.length) {
    return imageUrl(serverUrl, item.Id, 'Backdrop', {
      maxWidth,
      quality: 80,
      tag: item.BackdropImageTags[0],
    });
  }
  if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
    return imageUrl(serverUrl, item.ParentBackdropItemId, 'Backdrop', {
      maxWidth,
      quality: 80,
      tag: item.ParentBackdropImageTags[0],
    });
  }
  return undefined;
}

/** Title treatment (the show's stylised logo), when the server has one. */
export function logoUrl(serverUrl: string, item: BaseItemDto): string | undefined {
  const tag = item.ImageTags?.Logo;
  if (tag) {
    return imageUrl(serverUrl, item.Id, 'Logo', {maxWidth: 600, tag});
  }
  return undefined;
}
