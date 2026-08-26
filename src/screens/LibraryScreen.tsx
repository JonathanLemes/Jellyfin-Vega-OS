import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {Focusable} from '../components/Focusable';
import {MediaCard} from '../components/MediaCard';
import {LIST_PERFORMANCE_PROPS} from '../components/listConfig';
import {EmptyView, ErrorView, LoadingView, Screen} from '../components/Screen';
import {useApi, useApp} from '../state/AppContext';
import {colors, radius, safeArea, spacing, typography} from '../theme/theme';
import type {BaseItemDto} from '../api/types';
import type {Route} from '../navigation/routes';

interface Props {
  libraryId: string;
  title: string;
  collectionType?: string;
  onNavigate: (route: Route) => void;
}

interface SortOption {
  key: string;
  label: string;
  sortBy: string[];
  sortOrder: 'Ascending' | 'Descending';
}

/** The sort choices jellyfin-web offers on a library page. */
const SORT_OPTIONS: SortOption[] = [
  {key: 'name', label: 'Name', sortBy: ['SortName'], sortOrder: 'Ascending'},
  {key: 'added', label: 'Recently Added', sortBy: ['DateCreated'], sortOrder: 'Descending'},
  {key: 'released', label: 'Release Date', sortBy: ['PremiereDate'], sortOrder: 'Descending'},
  {key: 'rating', label: 'Rating', sortBy: ['CommunityRating'], sortOrder: 'Descending'},
  {key: 'played', label: 'Recently Played', sortBy: ['DatePlayed'], sortOrder: 'Descending'},
];

const PAGE_SIZE = 60;
const COLUMNS = 6;

/** Maps a library's collection type to the item types it should list. */
function itemTypesFor(collectionType?: string): string[] | undefined {
  switch (collectionType) {
    case 'movies':
      return ['Movie'];
    case 'tvshows':
      return ['Series'];
    case 'music':
      return ['MusicAlbum'];
    case 'boxsets':
      return ['BoxSet'];
    case 'musicvideos':
      return ['MusicVideo'];
    case 'homevideos':
      return ['Video', 'Photo'];
    default:
      // Mixed or unknown libraries: let the server decide what lives there.
      return undefined;
  }
}

/**
 * A paged poster grid for one library.
 *
 * Items are appended as the user scrolls rather than fetched all at once,
 * which keeps the first paint fast on libraries with thousands of entries.
 */
export const LibraryScreen = ({libraryId, title, collectionType, onNavigate}: Props) => {
  const api = useApi();
  const {session} = useApp();
  const [items, setItems] = useState<BaseItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [sortKey, setSortKey] = useState('name');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Guards against overlapping page requests when scrolling quickly.
  const requestId = useRef(0);

  const sort = useMemo(
    () => SORT_OPTIONS.find(option => option.key === sortKey) ?? SORT_OPTIONS[0],
    [sortKey],
  );
  const includeItemTypes = useMemo(() => itemTypesFor(collectionType), [collectionType]);

  const loadPage = useCallback(
    async (startIndex: number) => {
      const id = ++requestId.current;
      if (startIndex === 0) {
        setLoading(true);
        setError(undefined);
      } else {
        setLoadingMore(true);
      }
      try {
        const response = await api.getItems({
          parentId: libraryId,
          includeItemTypes,
          sortBy: sort.sortBy,
          sortOrder: sort.sortOrder,
          startIndex,
          limit: PAGE_SIZE,
          recursive: true,
        });
        if (id !== requestId.current) {
          return; // A newer request superseded this one.
        }
        setTotal(response.TotalRecordCount ?? 0);
        setItems(prev => (startIndex === 0 ? response.Items ?? [] : [...prev, ...(response.Items ?? [])]));
      } catch (err) {
        if (id === requestId.current) {
          setError((err as Error).message);
        }
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [api, includeItemTypes, libraryId, sort],
  );

  useEffect(() => {
    setItems([]);
    loadPage(0);
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || items.length >= total) {
      return;
    }
    loadPage(items.length);
  }, [items.length, loadPage, loading, loadingMore, total]);

  const openItem = useCallback(
    (item: BaseItemDto) => onNavigate({name: 'detail', itemId: item.Id}),
    [onNavigate],
  );

  const serverUrl = session?.serverUrl ?? '';
  const shape = collectionType === 'music' ? 'square' : 'portrait';

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {total > 0 ? (
            <Text style={styles.count}>
              {total} {total === 1 ? 'item' : 'items'}
            </Text>
          ) : null}
        </View>
        <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight style={styles.sortRow}>
          {SORT_OPTIONS.map(option => (
            <Focusable
              accessibilityLabel={`Sort by ${option.label}`}
              key={option.key}
              onPress={() => setSortKey(option.key)}
              style={styles.sortWrapper}>
              {focused => (
                <View
                  style={[
                    styles.sortChip,
                    sortKey === option.key && styles.sortChipActive,
                    focused && styles.sortChipFocused,
                  ]}>
                  <Text
                    style={[
                      styles.sortLabel,
                      sortKey === option.key && styles.sortLabelActive,
                      focused && styles.sortLabelFocused,
                    ]}>
                    {option.label}
                  </Text>
                </View>
              )}
            </Focusable>
          ))}
        </TVFocusGuideView>
      </View>

      {loading && !items.length ? (
        <LoadingView />
      ) : error && !items.length ? (
        <ErrorView message={error} onBack={() => onNavigate({name: 'home'})} onRetry={() => loadPage(0)} />
      ) : !items.length ? (
        <EmptyView message="This library is empty." />
      ) : (
        <FlatList
          {...LIST_PERFORMANCE_PROPS}
          data={items}
          numColumns={COLUMNS}
          keyExtractor={item => item.Id}
          contentContainerStyle={styles.grid}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          renderItem={({item, index}) => (
            <MediaCard
              autoFocus={index === 0}
              item={item}
              onPress={openItem}
              serverUrl={serverUrl}
              shape={shape}
            />
          )}
          ListFooterComponent={loadingMore ? <LoadingView /> : null}
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: safeArea.horizontal,
    paddingTop: safeArea.vertical,
    paddingBottom: spacing.md,
  },
  headerText: {flexShrink: 1},
  title: typography.title,
  count: {...typography.caption, marginTop: 2},
  sortRow: {alignItems: 'center', flexDirection: 'row'},
  sortWrapper: {marginLeft: spacing.xs},
  sortChip: {
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sortChipActive: {backgroundColor: colors.accent},
  sortChipFocused: {backgroundColor: colors.text},
  sortLabel: {color: colors.textSecondary, fontSize: 15, fontWeight: '600'},
  sortLabelActive: {color: colors.text},
  sortLabelFocused: {color: colors.background},
  grid: {paddingHorizontal: safeArea.horizontal - spacing.sm, paddingBottom: spacing.xxl},
});
