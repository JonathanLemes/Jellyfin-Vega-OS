import React from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {MediaCard, type CardShape} from './MediaCard';
import {SHELF_PERFORMANCE_PROPS} from './listConfig';
import {colors, safeArea, spacing, typography} from '../theme/theme';
import type {BaseItemDto} from '../api/types';

interface Props {
  title: string;
  items: BaseItemDto[];
  serverUrl: string;
  shape?: CardShape;
  onSelect: (item: BaseItemDto) => void;
  onItemFocus?: (item: BaseItemDto) => void;
  autoFocusFirst?: boolean;
}

/**
 * A titled horizontal row of cards, the building block of the home screen.
 *
 * `TVFocusGuideView` keeps the remote's focus inside the row while moving
 * left/right and hands it to the next row on up/down, which is what makes a
 * stack of shelves feel right on a TV.
 */
export const Shelf = ({
  title,
  items,
  serverUrl,
  shape = 'portrait',
  onSelect,
  onItemFocus,
  autoFocusFirst = false,
}: Props) => {
  if (!items.length) {
    return null;
  }
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight>
        <FlatList
          {...SHELF_PERFORMANCE_PROPS}
          data={items}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={item => item.Id}
          contentContainerStyle={styles.row}
          renderItem={({item, index}) => (
            <MediaCard
              autoFocus={autoFocusFirst && index === 0}
              item={item}
              onFocus={onItemFocus}
              onPress={onSelect}
              serverUrl={serverUrl}
              shape={shape}
            />
          )}
        />
      </TVFocusGuideView>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {marginBottom: spacing.lg},
  title: {
    ...typography.sectionTitle,
    color: colors.text,
    marginBottom: spacing.sm,
    marginLeft: safeArea.horizontal,
  },
  // Padding rather than margin so the first and last card can still scroll
  // fully into view inside the safe area.
  row: {paddingHorizontal: safeArea.horizontal - spacing.sm},
});
