import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {JellyfinApi} from '../api/jellyfin';
import {buildDeviceProfile, type DeviceProfile} from '../api/deviceProfile';
import {buildIdentity, clearSession, loadOrCreateDeviceId, loadSession, saveSession} from './storage';
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
      setIdentity(buildIdentity(deviceId, DEVICE_NAME));
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
    await saveSession(next);
    setSession(next);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(undefined);
  }, []);

  // Built once: probing the media stack on every render would be wasteful, and
  // the device's capabilities cannot change while the app is running.
  const deviceProfile = useMemo(() => buildDeviceProfile(), []);

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
