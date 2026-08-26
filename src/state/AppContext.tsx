import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {JellyfinApi} from '../api/jellyfin';
import {buildDeviceProfile, type DeviceProfile} from '../api/deviceProfile';
import {buildMeasuredDeviceProfile} from '../api/vegaCapabilities';
import {
  buildIdentity,
  clearCredentials,
  clearSession,
  loadOrCreateDeviceId,
  loadSession,
  saveSession,
} from './storage';
import type {DeviceIdentity, Session} from '../api/types';

interface AppState {
  /** True until the persisted session has been read from disk. */
  initializing: boolean;
  session?: Session;
  api?: JellyfinApi;
  identity?: DeviceIdentity;
  deviceProfile: DeviceProfile;
  signIn(session: Session): Promise<void>;
  signOut(): Promise<void>;
}

const AppContext = createContext<AppState | undefined>(undefined);

/** Name shown for this device in Jellyfin's dashboard. */
const DEVICE_NAME = 'Fire TV (Vega)';

export const AppProvider = ({children}: {children: React.ReactNode}) => {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | undefined>();
  const [identity, setIdentity] = useState<DeviceIdentity | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const deviceId = await loadOrCreateDeviceId();
      const restored = await loadSession();
      if (cancelled) {
        return;
      }
      const id = buildIdentity(deviceId, DEVICE_NAME);
      setIdentity(id);
      // A stored session may carry a device id from an earlier install; the
      // current one wins so the server sees a single consistent device.
      setSession(restored ? {...restored, deviceId} : undefined);
      setInitializing(false);

    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (next: Session) => {
    // The session is adopted whether or not it can be persisted. Letting a
    // storage failure propagate would strand the user on the sign-in screen
    // with a valid token already issued by the server; the worst case here is
    // having to sign in again after a restart.
    try {
      await saveSession(next);
    } catch (error) {
      console.warn('Could not persist the session', error);
    }
    setSession(next);
  }, []);

  const signOut = useCallback(async () => {
    // Remembered credentials go too, otherwise the sign-in screen would
    // immediately log the user back in.
    await Promise.all([clearSession(), clearCredentials()]);
    setSession(undefined);
  }, []);

  // Measured once at start-up. Until the probe answers, the conservative
  // built-in profile is used so playback is never blocked on it.
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile>(() => buildDeviceProfile());

  useEffect(() => {
    let cancelled = false;
    buildMeasuredDeviceProfile()
      .then(({profile}) => {
        if (!cancelled) {
          setDeviceProfile(profile);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const api = useMemo(
    () => (session && identity ? new JellyfinApi(session, identity) : undefined),
    [session, identity],
  );

  const value = useMemo<AppState>(
    () => ({initializing, session, api, identity, deviceProfile, signIn, signOut}),
    [initializing, session, api, identity, deviceProfile, signIn, signOut],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return context;
}

/** Convenience accessor for screens that only render once signed in. */
export function useApi(): JellyfinApi {
  const {api} = useApp();
  if (!api) {
    throw new Error('useApi requires an authenticated session');
  }
  return api;
}
