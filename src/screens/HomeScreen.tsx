import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {NavBar, type NavTab} from '../components/NavBar';
import {Screen, ErrorView, LoadingView} from '../components/Screen';
import {Shelf} from '../components/Shelf';
import {useApi, useApp} from '../state/AppContext';
import {spacing} from '../theme/theme';
import type {BaseItemDto} from '../api/types';
import type {Route} from '../navigation/routes';

interface Props {
  onNavigate: (route: Route) => void;
}

interface HomeData {
  views: BaseItemDto[];
  resume: BaseItemDto[];
  nextUp: BaseItemDto[];
  latest: Array<{library: BaseItemDto; items: BaseItemDto[]}>;
}

/** Library kinds that get a "Latest" shelf; others are reachable via the tabs. */
const LATEST_COLLECTION_TYPES = ['movies', 'tvshows', 'music', 'homevideos', 'boxsets', 'musicvideos'];

/**
 * The landing screen, mirroring jellyfin-web's home: Continue Watching, Next
 * Up, then a "Latest" row per library.
 *
 * All shelves are fetched together so the screen appears in one paint rather
 * than popping in row by row.
 */
export const HomeScreen = ({onNavigate}: Props) => {
  const api = useApi();
  const {session} = useApp();
  const [data, setData] = useState<HomeData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const viewsResponse = await api.getViews();
      const views = viewsResponse.Items ?? [];

      const [resume, nextUp] = await Promise.all([api.getResumable(), api.getNextUp()]);

      const latestLibraries = views.filter(
        view => view.CollectionType && LATEST_COLLECTION_TYPES.includes(view.CollectionType),
      );
      const latest = await Promise.all(
        latestLibraries.map(async library => ({
          library,
          // One failing library must not blank out the whole home screen.
          items: await api.getLatest(library.Id).catch(() => [] as BaseItemDto[]),
        })),
      );

      setData({
        views,
        resume: resume.Items ?? [],
        nextUp: nextUp.Items ?? [],
        latest: latest.filter(entry => entry.items.length > 0),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const tabs = useMemo<NavTab[]>(() => {
    const libraryTabs = (data?.views ?? []).map(view => ({
      key: view.Id,
      label: view.Name ?? 'Library',
    }));
    return [
      {key: 'home', label: 'Home'},
      ...libraryTabs,
      {key: 'search', label: 'Search'},
      {key: 'settings', label: 'Settings'},
    ];
  }, [data?.views]);

  const onTab = useCallback(
    (key: string) => {
      if (key === 'home') {
        return;
      }
      if (key === 'search') {
        onNavigate({name: 'search'});
        return;
      }
      if (key === 'settings') {
        onNavigate({name: 'settings'});
        return;
      }
      const view = data?.views.find(v => v.Id === key);
      if (view) {
        onNavigate({
          name: 'library',
          libraryId: view.Id,
          title: view.Name ?? 'Library',
          collectionType: view.CollectionType,
        });
      }
    },
    [data?.views, onNavigate],
  );

  const openItem = useCallback(
    (item: BaseItemDto) => onNavigate({name: 'detail', itemId: item.Id}),
    [onNavigate],
  );

  const serverUrl = session?.serverUrl ?? '';

  if (loading && !data) {
    return (
      <Screen>
        <LoadingView label="Loading your library" />
      </Screen>
    );
  }
  if (error && !data) {
    return (
      <Screen>
        <ErrorView message={error} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen>
      <NavBar activeKey="home" onSelect={onTab} tabs={tabs} userName={session?.userName} />
      <ScrollView contentContainerStyle={styles.content}>
        <Shelf
          autoFocusFirst
          items={data?.resume ?? []}
          onSelect={openItem}
          serverUrl={serverUrl}
          shape="wide"
          title="Continue Watching"
        />
        <Shelf
          items={data?.nextUp ?? []}
          onSelect={openItem}
          serverUrl={serverUrl}
          shape="wide"
          title="Next Up"
        />
        {(data?.latest ?? []).map(entry => (
          <Shelf
            items={entry.items}
            key={entry.library.Id}
            onSelect={openItem}
            serverUrl={serverUrl}
            shape={entry.library.CollectionType === 'music' ? 'square' : 'portrait'}
            title={`Latest in ${entry.library.Name ?? 'Library'}`}
          />
        ))}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  content: {paddingTop: spacing.lg},
  // Gives the last shelf room to scroll clear of the panel's bottom overscan.
  bottomSpacer: {height: spacing.xxl},
});
