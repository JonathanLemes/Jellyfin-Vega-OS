import React, {useCallback, useEffect} from 'react';
import {StatusBar} from 'react-native';
import {useKeplerBackHandler} from '@amazon-devices/react-native-kepler';
import {Screen, SplashView} from './components/Screen';
import {ConnectScreen} from './screens/ConnectScreen';
import {DetailScreen} from './screens/DetailScreen';
import {HomeScreen} from './screens/HomeScreen';
import {LibraryScreen} from './screens/LibraryScreen';
import {PlayerScreen} from './screens/PlayerScreen';
import {SearchScreen} from './screens/SearchScreen';
import {SettingsScreen} from './screens/SettingsScreen';
import {useNavigation} from './navigation/useNavigation';
import {AppProvider, useApp} from './state/AppContext';

/**
 * Renders the current route and wires the remote's Back key to the stack.
 *
 * Back is handled here rather than per screen so there is exactly one place
 * that decides what "backwards" means.
 *
 * `KeplerBackHandler` is used rather than a raw key listener because it is the
 * only way to *consume* the press. Observing Back through `useTVEventHandler`
 * leaves the platform's default in place, so the app closed even when there
 * was somewhere to go back to. Returning `true` here claims the press;
 * returning `false` at the root lets the platform close the app, which is the
 * behaviour a TV user expects.
 */
const Router = () => {
  const navigation = useNavigation();
  const route = navigation.current;
  const backHandler = useKeplerBackHandler();

  useEffect(() => {
    const subscription = backHandler.addEventListener('hardwareBackPress', () =>
      navigation.pop(),
    );
    return () => subscription.remove();
  }, [backHandler, navigation]);

  const navigate = useCallback(
    (next: Parameters<typeof navigation.push>[0]) => {
      if (next.name === 'home') {
        navigation.reset(next);
      } else {
        navigation.push(next);
      }
    },
    [navigation],
  );

  const goBack = useCallback(() => {
    if (!navigation.pop()) {
      navigation.reset({name: 'home'});
    }
  }, [navigation]);

  switch (route.name) {
    case 'library':
      return (
        <LibraryScreen
          collectionType={route.collectionType}
          libraryId={route.libraryId}
          onNavigate={navigate}
          title={route.title}
        />
      );
    case 'detail':
      return <DetailScreen itemId={route.itemId} onBack={goBack} onNavigate={navigate} />;
    case 'search':
      return <SearchScreen onNavigate={navigate} />;
    case 'settings':
      return <SettingsScreen onBack={goBack} />;
    case 'player':
      return (
        <PlayerScreen
          itemId={route.itemId}
          mediaSourceId={route.mediaSourceId}
          onExit={goBack}
          startPositionTicks={route.startPositionTicks}
        />
      );
    case 'home':
    default:
      return <HomeScreen onNavigate={navigate} />;
  }
};

/** Chooses between onboarding and the signed-in app. */
const Root = () => {
  const {initializing, session} = useApp();

  if (initializing) {
    return (
      <Screen>
        <SplashView />
      </Screen>
    );
  }
  // Remounting the router on sign-in/sign-out clears any screen state that
  // belonged to the previous session.
  return session ? <Router key={session.userId} /> : <ConnectScreen />;
};

export const App = () => (
  <AppProvider>
    <StatusBar hidden />
    <Root />
  </AppProvider>
);
