import React, {useMemo} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {Artwork} from './Artwork';
import {Focusable} from './Focusable';
import {colors, focusRing, focusScale, poster, radius, spacing} from '../theme/theme';
import {posterCandidates, thumbCandidates} from '../api/images';
import {episodeLabel, subtitleFor, titleFor, watchedFraction} from '../utils/format';
import type {BaseItemDto} from '../api/types';

export type CardShape = 'portrait' | 'wide' | 'square';

interface Props {
  item: BaseItemDto;
  serverUrl: string;
  shape?: CardShape;
  onPress: (item: BaseItemDto) => void;
  onFocus?: (item: BaseItemDto) => void;
  autoFocus?: boolean;
  /** Hides the caption block for grids that show titles elsewhere. */
  showTitle?: boolean;
}

/**
 * A single artwork tile, matching the jellyfin-web card: image, focus ring,
 * a resume bar when partly watched, an unwatched-count badge, and a two-line
 * caption underneath.
 */
export const MediaCard = ({
  item,
  serverUrl,
  shape = 'portrait',
  onPress,
  onFocus,
  autoFocus = false,
  showTitle = true,
}: Props) => {
  const size = shape === 'wide'
    ? {width: poster.wideWidth, height: poster.wideHeight}
    : shape === 'square'
    ? {width: poster.width, height: poster.width}
    : {width: poster.width, height: poster.height};

  const sources = useMemo(
    () =>
      shape === 'wide'
        ? thumbCandidates(serverUrl, item, Math.round(size.width * 1.5))
        : posterCandidates(serverUrl, item, Math.round(size.height * 1.5)),
    [item, serverUrl, shape, size.height, size.width],
  );

  const progress = watchedFraction(item);
  const unplayed = item.UserData?.UnplayedItemCount ?? 0;
  const played = item.UserData?.Played === true && item.Type !== 'Series';

  return (
    <Focusable
      accessibilityLabel={titleFor(item)}
      autoFocus={autoFocus}
      onFocus={() => onFocus?.(item)}
      onPress={() => onPress(item)}
      style={styles.wrapper}>
      {focused => (
        <View style={[styles.container, {width: size.width}]}>
          <View
            style={[
              styles.artwork,
              size,
              focused && focusRing,
              focused && {transform: [{scale: focusScale}]},
            ]}>
            <Artwork
              fallbackText={titleFor(item)}
              sources={sources}
              style={styles.image}
            />

            {unplayed > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unplayed}</Text>
              </View>
            ) : played ? (
              <View style={[styles.badge, styles.badgePlayed]}>
                <Text style={styles.badgeText}>✓</Text>
              </View>
            ) : null}

            {shape === 'wide' && item.Type === 'Episode' ? (
              <View style={styles.episodeChip}>
                <Text style={styles.episodeChipText}>{episodeLabel(item)}</Text>
              </View>
            ) : null}

            {progress > 0 && progress < 1 ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, {width: `${progress * 100}%`}]} />
              </View>
            ) : null}
          </View>

          {showTitle ? (
            <View style={styles.caption}>
              <Text
                style={[styles.title, focused && styles.titleFocused]}
                numberOfLines={1}>
                {item.Type === 'Episode' ? item.SeriesName ?? titleFor(item) : titleFor(item)}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {item.Type === 'Episode' ? `${episodeLabel(item)} · ${titleFor(item)}` : subtitleFor(item)}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </Focusable>
  );
};

const styles = StyleSheet.create({
  // Margin lives on the wrapper so the focus scale does not clip neighbours.
  wrapper: {margin: spacing.sm},
  container: {alignItems: 'flex-start'},
  artwork: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  image: {height: '100%', width: '100%'},
  placeholder: {
    alignItems: 'center',
    backgroundColor: colors.card,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.sm,
  },
  placeholderText: {
    color: colors.textTertiary,
    fontSize: 14,
    textAlign: 'center',
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minWidth: 26,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: 'absolute',
    right: 6,
    top: 6,
  },
  badgePlayed: {backgroundColor: colors.success},
  badgeText: {color: colors.text, fontSize: 13, fontWeight: '700'},
  episodeChip: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: radius.sm,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: 'absolute',
    top: 6,
  },
  episodeChipText: {color: colors.text, fontSize: 12, fontWeight: '600'},
  progressTrack: {
    backgroundColor: colors.progressTrack,
    bottom: 0,
    height: 5,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  progressFill: {backgroundColor: colors.progress, height: '100%'},
  caption: {marginTop: spacing.sm, width: '100%'},
  title: {color: colors.text, fontSize: 15, fontWeight: '600'},
  titleFocused: {color: colors.accentBright},
  subtitle: {color: colors.textTertiary, fontSize: 13, marginTop: 2},
});
