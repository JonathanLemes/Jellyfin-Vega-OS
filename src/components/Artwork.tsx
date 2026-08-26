import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, View, type StyleProp, type ImageStyle} from 'react-native';
import {colors, spacing} from '../theme/theme';

interface Props {
  /** Candidate URLs, best first; each is tried in turn on failure. */
  sources: string[];
  style?: StyleProp<ImageStyle>;
  /** Shown when every candidate fails, so the tile is still identifiable. */
  fallbackText?: string;
  resizeMode?: 'cover' | 'contain';
}

/**
 * An image that falls forward through alternative artwork when one 404s.
 *
 * Jellyfin's image tags only mean the server has metadata for a picture, not
 * that the file is still on disk — a library whose artwork has gone missing
 * answers 404 for tagged images. Without this, "Continue Watching" and
 * "Next Up" rows render as grey boxes even though a usable series backdrop or
 * poster exists.
 */
export const Artwork = ({sources, style, fallbackText, resizeMode = 'cover'}: Props) => {
  const [index, setIndex] = useState(0);

  // Restart from the best candidate when the item behind the tile changes.
  useEffect(() => {
    setIndex(0);
  }, [sources[0]]);

  const uri = sources[index];

  if (!uri) {
    return (
      <View style={[styles.placeholder, style]}>
        {fallbackText ? (
          <Text style={styles.placeholderText} numberOfLines={3}>
            {fallbackText}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <Image
      key={uri}
      onError={() => setIndex(current => current + 1)}
      resizeMode={resizeMode}
      source={{uri}}
      style={style}
    />
  );
};

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    backgroundColor: colors.card,
    justifyContent: 'center',
    padding: spacing.sm,
  },
  placeholderText: {color: colors.textTertiary, fontSize: 14, textAlign: 'center'},
});
