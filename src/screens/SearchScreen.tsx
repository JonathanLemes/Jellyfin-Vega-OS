import React, {useCallback, useEffect, useRef, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {MediaCard} from '../components/MediaCard';
import {LIST_PERFORMANCE_PROPS} from '../components/listConfig';
import {EmptyView, LoadingView, Screen} from '../components/Screen';
import {TextField} from '../components/TextField';
import {useApi, useApp} from '../state/AppContext';
import {colors, radius, safeArea, spacing, typography} from '../theme/theme';
import type {BaseItemDto} from '../api/types';
import type {Route} from '../navigation/routes';

interface Props {
  onNavigate: (route: Route) => void;
}

/** Item kinds worth returning from a TV search. */
const SEARCH_TYPES = ['Movie', 'Series', 'Episode', 'MusicAlbum', 'MusicArtist', 'BoxSet', 'Person'];

/** Debounce so a remote's slow typing does not fire a request per keystroke. */
const DEBOUNCE_MS = 400;

export const SearchScreen = ({onNavigate}: Props) => {
  const api = useApi();
  const {session} = useApp();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<BaseItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await api.getItems({
          searchTerm: trimmed,
          includeItemTypes: SEARCH_TYPES,
          recursive: true,
          limit: 60,
        });
        if (id === requestId.current) {
          setResults(response.Items ?? []);
          setSearched(true);
        }
      } catch {
        if (id === requestId.current) {
          setResults([]);
          setSearched(true);
        }
      } finally {
        if (id === requestId.current) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, term]);

  const openItem = useCallback(
    (item: BaseItemDto) => onNavigate({name: 'detail', itemId: item.Id}),
    [onNavigate],
  );

  const serverUrl = session?.serverUrl ?? '';

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <TextField
          autoFocus
          onChangeText={setTerm}
          placeholder="Search movies, shows and episodes"
          style={styles.searchField}
          value={term}
        />
      </View>

      {loading ? (
        <LoadingView />
      ) : results.length ? (
        <FlatList
          {...LIST_PERFORMANCE_PROPS}
          data={results}
          numColumns={6}
          keyExtractor={item => item.Id}
          contentContainerStyle={styles.grid}
          renderItem={({item}) => (
            <MediaCard
              item={item}
              onPress={openItem}
              serverUrl={serverUrl}
              shape={item.Type === 'Episode' ? 'wide' : 'portrait'}
            />
          )}
        />
      ) : searched ? (
        <EmptyView message={`Nothing found for "${term.trim()}".`} />
      ) : (
        <EmptyView message="Type at least two characters to search." />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  header: {paddingHorizontal: safeArea.horizontal, paddingTop: safeArea.vertical},
  title: {...typography.title, marginBottom: spacing.md},
  searchField: {marginBottom: spacing.lg, maxWidth: 900},
  grid: {paddingHorizontal: safeArea.horizontal - spacing.sm, paddingBottom: spacing.xxl},
});
