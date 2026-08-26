import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {Button} from '../components/Button';
import {Focusable} from '../components/Focusable';
import {Gradient} from '../components/Gradient';
import {ErrorView, LoadingView, Screen} from '../components/Screen';
import {Shelf} from '../components/Shelf';
import {backdropUrl, logoUrl, posterUrl, thumbUrl} from '../api/images';
import {useApi, useApp} from '../state/AppContext';
import {colors, radius, safeArea, spacing, typography} from '../theme/theme';
import {
  episodeLabel,
  formatRating,
  formatRuntime,
  formatYearRange,
  watchedFraction,
} from '../utils/format';
import type {BaseItemDto} from '../api/types';
import type {Route} from '../navigation/routes';

interface Props {
  itemId: string;
  onNavigate: (route: Route) => void;
  onBack: () => void;
}

/**
 * Item detail, following the jellyfin-web layout: full-bleed backdrop, poster
 * and metadata on the left, then actions, overview, cast, and — for a series —
 * a season picker with its episode list.
 */
export const DetailScreen = ({itemId, onNavigate, onBack}: Props) => {
  const api = useApi();
  const {session} = useApp();
  const [item, setItem] = useState<BaseItemDto | undefined>();
  const [seasons, setSeasons] = useState<BaseItemDto[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | undefined>();
  const [episodes, setEpisodes] = useState<BaseItemDto[]>([]);
  const [similar, setSimilar] = useState<BaseItemDto[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const detail = await api.getItem(itemId);
      setItem(detail);

      if (detail.Type === 'Series') {
        const seasonResponse = await api.getSeasons(detail.Id);
        const seasonItems = seasonResponse.Items ?? [];
        setSeasons(seasonItems);
        // Open on the season holding the next unwatched episode when there is
        // one, so resuming a show takes a single click.
        const firstUnwatched = seasonItems.find(s => (s.UserData?.UnplayedItemCount ?? 0) > 0);
        setSelectedSeasonId((firstUnwatched ?? seasonItems[0])?.Id);
      } else {
        setSeasons([]);
        setSelectedSeasonId(undefined);
        setEpisodes([]);
      }

      // Recommendations are decorative: a failure must not break the page.
      setSimilar(await api.getSimilar(detail.Id).then(r => r.Items ?? []).catch(() => []));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, itemId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!item || item.Type !== 'Series' || !selectedSeasonId) {
      return;
    }
    let cancelled = false;
    api
      .getEpisodes(item.Id, selectedSeasonId)
      .then(response => {
        if (!cancelled) {
          setEpisodes(response.Items ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEpisodes([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, item, selectedSeasonId]);

  const serverUrl = session?.serverUrl ?? '';
  const backdrop = useMemo(() => (item ? backdropUrl(serverUrl, item) : undefined), [item, serverUrl]);
  const logo = useMemo(() => (item ? logoUrl(serverUrl, item) : undefined), [item, serverUrl]);
  const poster = useMemo(() => (item ? posterUrl(serverUrl, item, 480) : undefined), [item, serverUrl]);

  const play = useCallback(
    (target: BaseItemDto, resume: boolean) => {
      onNavigate({
        name: 'player',
        itemId: target.Id,
        startPositionTicks: resume ? target.UserData?.PlaybackPositionTicks ?? 0 : 0,
      });
    },
    [onNavigate],
  );

  const toggleWatched = useCallback(async () => {
    if (!item) {
      return;
    }
    const next = !item.UserData?.Played;
    // Update locally first so the button responds immediately on a TV, where
    // a round trip to the server is visibly slow.
    setItem({...item, UserData: {...item.UserData, Played: next}});
    try {
      await api.setPlayed(item.Id, next);
    } catch {
      setItem(current => (current ? {...current, UserData: {...current.UserData, Played: !next}} : current));
    }
  }, [api, item]);

  const toggleFavorite = useCallback(async () => {
    if (!item) {
      return;
    }
    const next = !item.UserData?.IsFavorite;
    setItem({...item, UserData: {...item.UserData, IsFavorite: next}});
    try {
      await api.setFavorite(item.Id, next);
    } catch {
      setItem(current =>
        current ? {...current, UserData: {...current.UserData, IsFavorite: !next}} : current,
      );
    }
  }, [api, item]);

  if (loading && !item) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (error || !item) {
    return (
      <Screen>
        <ErrorView message={error ?? 'Item not found.'} onBack={onBack} onRetry={load} />
      </Screen>
    );
  }

  const resumeTicks = item.UserData?.PlaybackPositionTicks ?? 0;
  const canResume = resumeTicks > 0 && item.Type !== 'Series';
  const metadata = [
    formatYearRange(item),
    item.OfficialRating,
    formatRuntime(item.RunTimeTicks),
    item.CommunityRating ? `★ ${formatRating(item.CommunityRating)}` : '',
  ].filter(Boolean);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          {backdrop ? (
            <Image source={{uri: backdrop}} style={styles.backdrop} resizeMode="cover" />
          ) : null}
          {/* Two gradients: one darkens the bottom for the text, the other the
              left edge so the poster and metadata column stay readable. */}
          <Gradient
            id="detailVertical"
            stops={[
              {color: colors.background, offset: 0, opacity: 0.35},
              {color: colors.background, offset: 0.55, opacity: 0.85},
              {color: colors.background, offset: 1, opacity: 1},
            ]}
          />
          <Gradient
            direction="horizontal"
            id="detailHorizontal"
            stops={[
              {color: colors.background, offset: 0, opacity: 0.95},
              {color: colors.background, offset: 0.65, opacity: 0.2},
              {color: colors.background, offset: 1, opacity: 0},
            ]}
          />

          <View style={styles.heroContent}>
            {poster ? (
              <Image source={{uri: poster}} style={styles.poster} resizeMode="cover" />
            ) : null}

            <View style={styles.heroText}>
              {logo ? (
                <Image source={{uri: logo}} style={styles.logo} resizeMode="contain" />
              ) : (
                <Text style={styles.title} numberOfLines={2}>
                  {item.Name}
                </Text>
              )}

              {item.Type === 'Episode' ? (
                <Text style={styles.episodeLine}>
                  {[item.SeriesName, episodeLabel(item)].filter(Boolean).join(' · ')}
                </Text>
              ) : null}

              {item.Taglines?.length ? (
                <Text style={styles.tagline} numberOfLines={1}>
                  {item.Taglines[0]}
                </Text>
              ) : null}

              <View style={styles.metaRow}>
                {metadata.map((value, index) => (
                  <View key={index} style={styles.metaItem}>
                    {index > 0 ? <View style={styles.metaDot} /> : null}
                    <Text style={styles.metaText}>{value}</Text>
                  </View>
                ))}
              </View>

              {item.Genres?.length ? (
                <Text style={styles.genres} numberOfLines={1}>
                  {item.Genres.join(' · ')}
                </Text>
              ) : null}

              {canResume ? (
                <View style={styles.resumeBar}>
                  <View
                    style={[styles.resumeFill, {width: `${watchedFraction(item) * 100}%`}]}
                  />
                </View>
              ) : null}

              <TVFocusGuideView autoFocus style={styles.actions}>
                {canResume ? (
                  <Button
                    autoFocus
                    icon="▶"
                    label={`Resume · ${formatRuntime(item.RunTimeTicks ? item.RunTimeTicks - resumeTicks : 0) || 'from where you left off'}`}
                    onPress={() => play(item, true)}
                    variant="primary"
                  />
                ) : null}
                {item.Type !== 'Series' ? (
                  <Button
                    autoFocus={!canResume}
                    icon="▶"
                    label={canResume ? 'Play from start' : 'Play'}
                    onPress={() => play(item, false)}
                    style={canResume ? styles.actionSpacer : undefined}
                    variant={canResume ? 'secondary' : 'primary'}
                  />
                ) : null}
                <Button
                  autoFocus={item.Type === 'Series'}
                  icon={item.UserData?.Played ? '✓' : '○'}
                  label={item.UserData?.Played ? 'Watched' : 'Mark watched'}
                  onPress={toggleWatched}
                  style={styles.actionSpacer}
                />
                <Button
                  icon={item.UserData?.IsFavorite ? '♥' : '♡'}
                  label="Favourite"
                  onPress={toggleFavorite}
                  style={styles.actionSpacer}
                />
              </TVFocusGuideView>
            </View>
          </View>
        </View>

        {item.Overview ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Overview</Text>
            <Text style={styles.overview}>{item.Overview}</Text>
          </View>
        ) : null}

        {item.Type === 'Series' && seasons.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Seasons</Text>
            <TVFocusGuideView trapFocusLeft trapFocusRight style={styles.seasonRow}>
              {seasons.map(season => (
                <Focusable
                  accessibilityLabel={season.Name ?? 'Season'}
                  key={season.Id}
                  onPress={() => setSelectedSeasonId(season.Id)}
                  style={styles.seasonWrapper}>
                  {focused => (
                    <View
                      style={[
                        styles.seasonChip,
                        selectedSeasonId === season.Id && styles.seasonChipActive,
                        focused && styles.seasonChipFocused,
                      ]}>
                      <Text
                        style={[
                          styles.seasonLabel,
                          selectedSeasonId === season.Id && styles.seasonLabelActive,
                          focused && styles.seasonLabelFocused,
                        ]}>
                        {season.Name}
                      </Text>
                    </View>
                  )}
                </Focusable>
              ))}
            </TVFocusGuideView>
          </View>
        ) : null}

        {episodes.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Episodes</Text>
            <TVFocusGuideView>
              {episodes.map(episode => (
                <EpisodeRow
                  episode={episode}
                  key={episode.Id}
                  onPress={() =>
                    onNavigate({
                      name: 'player',
                      itemId: episode.Id,
                      startPositionTicks: episode.UserData?.PlaybackPositionTicks ?? 0,
                    })
                  }
                  serverUrl={serverUrl}
                />
              ))}
            </TVFocusGuideView>
          </View>
        ) : null}

        {item.People?.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cast & Crew</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {item.People.slice(0, 20).map((person, index) => (
                <View key={`${person.Id ?? person.Name}-${index}`} style={styles.person}>
                  {person.PrimaryImageTag && person.Id ? (
                    <Image
                      source={{
                        uri: `${serverUrl}/Items/${person.Id}/Images/Primary?maxHeight=200&tag=${person.PrimaryImageTag}`,
                      }}
                      style={styles.personImage}
                    />
                  ) : (
                    <View style={[styles.personImage, styles.personPlaceholder]}>
                      <Text style={styles.personInitial}>
                        {(person.Name ?? '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.personName} numberOfLines={1}>
                    {person.Name}
                  </Text>
                  <Text style={styles.personRole} numberOfLines={1}>
                    {person.Role || person.Type}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {similar.length ? (
          <Shelf
            items={similar}
            onSelect={target => onNavigate({name: 'detail', itemId: target.Id})}
            serverUrl={serverUrl}
            title="More like this"
          />
        ) : null}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </Screen>
  );
};

/** One row in the episode list: still, numbering, runtime, and synopsis. */
const EpisodeRow = ({
  episode,
  serverUrl,
  onPress,
}: {
  episode: BaseItemDto;
  serverUrl: string;
  onPress: () => void;
}) => {
  const uri = thumbUrl(serverUrl, episode, 400);
  const progress = watchedFraction(episode);
  return (
    <Focusable accessibilityLabel={episode.Name ?? 'Episode'} onPress={onPress}>
      {focused => (
        <View style={[styles.episodeRow, focused && styles.episodeRowFocused]}>
          <View style={styles.episodeThumbWrapper}>
            {uri ? (
              <Image source={{uri}} style={styles.episodeThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.episodeThumb, styles.personPlaceholder]} />
            )}
            {progress > 0 && progress < 1 ? (
              <View style={styles.episodeProgressTrack}>
                <View style={[styles.episodeProgressFill, {width: `${progress * 100}%`}]} />
              </View>
            ) : null}
          </View>
          <View style={styles.episodeInfo}>
            <Text style={styles.episodeTitle} numberOfLines={1}>
              {episode.IndexNumber !== undefined ? `${episode.IndexNumber}. ` : ''}
              {episode.Name}
            </Text>
            <Text style={styles.episodeMeta}>
              {[
                formatRuntime(episode.RunTimeTicks),
                episode.UserData?.Played ? 'Watched' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {episode.Overview ? (
              <Text style={styles.episodeOverview} numberOfLines={2}>
                {episode.Overview}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </Focusable>
  );
};

const HERO_HEIGHT = 560;

const styles = StyleSheet.create({
  scroll: {paddingBottom: spacing.xxl},
  hero: {height: HERO_HEIGHT, justifyContent: 'flex-end'},
  backdrop: {...StyleSheet.absoluteFillObject, height: HERO_HEIGHT, width: '100%'},
  heroContent: {
    flexDirection: 'row',
    paddingBottom: spacing.xl,
    paddingHorizontal: safeArea.horizontal,
  },
  poster: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    height: 330,
    marginRight: spacing.xl,
    width: 220,
  },
  heroText: {flex: 1, justifyContent: 'flex-end'},
  logo: {height: 110, marginBottom: spacing.sm, width: 420},
  title: {...typography.hero, marginBottom: spacing.sm},
  episodeLine: {...typography.bodySecondary, marginBottom: spacing.xs},
  tagline: {
    color: colors.textSecondary,
    fontSize: 18,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },
  metaRow: {alignItems: 'center', flexDirection: 'row', marginBottom: spacing.xs},
  metaItem: {alignItems: 'center', flexDirection: 'row'},
  metaDot: {
    backgroundColor: colors.textTertiary,
    borderRadius: 2,
    height: 4,
    marginHorizontal: spacing.sm,
    width: 4,
  },
  metaText: {color: colors.textSecondary, fontSize: 16},
  genres: {...typography.caption, marginBottom: spacing.md},
  resumeBar: {
    backgroundColor: colors.progressTrack,
    borderRadius: radius.pill,
    height: 5,
    marginBottom: spacing.md,
    overflow: 'hidden',
    width: 420,
  },
  resumeFill: {backgroundColor: colors.progress, height: '100%'},
  actions: {alignItems: 'center', flexDirection: 'row', marginTop: spacing.sm},
  actionSpacer: {marginLeft: spacing.md},
  section: {paddingHorizontal: safeArea.horizontal, paddingTop: spacing.lg},
  sectionTitle: {...typography.sectionTitle, marginBottom: spacing.sm},
  overview: {...typography.body, color: colors.textSecondary, lineHeight: 26, maxWidth: 1200},
  seasonRow: {flexDirection: 'row', flexWrap: 'wrap'},
  seasonWrapper: {marginBottom: spacing.sm, marginRight: spacing.sm},
  seasonChip: {
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  seasonChipActive: {backgroundColor: colors.accent},
  seasonChipFocused: {backgroundColor: colors.text},
  seasonLabel: {color: colors.textSecondary, fontSize: 16, fontWeight: '600'},
  seasonLabelActive: {color: colors.text},
  seasonLabelFocused: {color: colors.background},
  episodeRow: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 3,
    borderColor: 'transparent',
    flexDirection: 'row',
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  episodeRowFocused: {backgroundColor: colors.card, borderColor: colors.text},
  episodeThumbWrapper: {borderRadius: radius.sm, overflow: 'hidden'},
  episodeThumb: {backgroundColor: colors.card, height: 124, width: 220},
  episodeProgressTrack: {
    backgroundColor: colors.progressTrack,
    bottom: 0,
    height: 4,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  episodeProgressFill: {backgroundColor: colors.progress, height: '100%'},
  episodeInfo: {flex: 1, marginLeft: spacing.md},
  episodeTitle: {...typography.label, fontSize: 18},
  episodeMeta: {...typography.caption, marginTop: 2},
  episodeOverview: {...typography.caption, marginTop: spacing.xs, maxWidth: 900},
  person: {marginRight: spacing.md, width: 120},
  personImage: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    height: 160,
    width: 120,
  },
  personPlaceholder: {alignItems: 'center', justifyContent: 'center'},
  personInitial: {color: colors.textTertiary, fontSize: 32, fontWeight: '700'},
  personName: {...typography.caption, color: colors.text, marginTop: spacing.xs},
  personRole: {...typography.caption, fontSize: 12},
  bottomSpacer: {height: spacing.xxl},
});
