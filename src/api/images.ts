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
 * Every wide-artwork candidate for an item, best first.
 *
 * A tag only says the server has metadata for an image, not that the file is
 * still on disk; Jellyfin answers 404 when the artwork has gone missing. The
 * card walks this list on load failure so a stale `Thumb` tag degrades to the
 * episode still, the series backdrop, and finally the poster, instead of
 * leaving a grey box.
 */
export function thumbCandidates(
  serverUrl: string,
  item: BaseItemDto,
  maxWidth = 640,
): string[] {
  const candidates = [
    item.ImageTags?.Thumb &&
      imageUrl(serverUrl, item.Id, 'Thumb', {maxWidth, tag: item.ImageTags.Thumb}),
    item.ImageTags?.Primary &&
      imageUrl(serverUrl, item.Id, 'Primary', {maxWidth, tag: item.ImageTags.Primary}),
    item.BackdropImageTags?.length &&
      imageUrl(serverUrl, item.Id, 'Backdrop', {maxWidth, tag: item.BackdropImageTags[0]}),
    item.ParentThumbItemId &&
      item.ParentThumbImageTag &&
      imageUrl(serverUrl, item.ParentThumbItemId, 'Thumb', {
        maxWidth,
        tag: item.ParentThumbImageTag,
      }),
    item.ParentBackdropItemId &&
      item.ParentBackdropImageTags?.length &&
      imageUrl(serverUrl, item.ParentBackdropItemId, 'Backdrop', {
        maxWidth,
        tag: item.ParentBackdropImageTags[0],
      }),
    // Last resort: the series poster. Wrong aspect ratio, but recognisable.
    item.SeriesId &&
      item.SeriesPrimaryImageTag &&
      imageUrl(serverUrl, item.SeriesId, 'Primary', {
        maxWidth,
        tag: item.SeriesPrimaryImageTag,
      }),
  ];
  return candidates.filter((c): c is string => typeof c === 'string');
}

/** Poster candidates for an item, best first. */
export function posterCandidates(
  serverUrl: string,
  item: BaseItemDto,
  maxHeight = 480,
): string[] {
  const candidates = [
    item.ImageTags?.Primary &&
      imageUrl(serverUrl, item.Id, 'Primary', {maxHeight, tag: item.ImageTags.Primary}),
    item.SeriesId &&
      item.SeriesPrimaryImageTag &&
      imageUrl(serverUrl, item.SeriesId, 'Primary', {
        maxHeight,
        tag: item.SeriesPrimaryImageTag,
      }),
    item.AlbumId &&
      item.AlbumPrimaryImageTag &&
      imageUrl(serverUrl, item.AlbumId, 'Primary', {
        maxHeight,
        tag: item.AlbumPrimaryImageTag,
      }),
    item.ImageTags?.Thumb &&
      imageUrl(serverUrl, item.Id, 'Thumb', {maxHeight, tag: item.ImageTags.Thumb}),
  ];
  return candidates.filter((c): c is string => typeof c === 'string');
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
