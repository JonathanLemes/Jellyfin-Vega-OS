import {AsyncStorage} from '@amazon-devices/react-native-kepler';
import type {DeviceIdentity, Session} from '../api/types';

/**
 * Persistence for the signed-in session, the device identity, and the
 * remembered sign-in details.
 *
 * `AsyncStorage` from the Kepler runtime is used rather than
 * `@amazon-devices/kepler-file-system`: on Vega OS 1.2 that module's
 * `readFileAsString` and `writeStringToFile` fail with
 * `com.amazon.kepler.io.IoError` for every path and open mode, so nothing
 * written through it survives. Only `exists`, `getEntries` and `openFile`
 * work there, which is not enough to store anything.
 *
 * Storage is private to the app and cleared when it is uninstalled.
 */
const SESSION_KEY = 'jellyfin.session';
const DEVICE_KEY = 'jellyfin.deviceId';
const CREDENTIALS_KEY = 'jellyfin.credentials';

async function readJson<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    // A corrupt or unreadable value must not stop the app from starting; the
    // user simply lands back on the sign-in screen.
    return undefined;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function remove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Nothing actionable: the in-memory state is dropped regardless.
  }
}

export function loadSession(): Promise<Session | undefined> {
  return readJson<Session>(SESSION_KEY);
}

export async function saveSession(session: Session): Promise<void> {
  await writeJson(SESSION_KEY, session);
}

export function clearSession(): Promise<void> {
  return remove(SESSION_KEY);
}

/**
 * The last server and account used, so the sign-in screen can pre-fill and
 * reconnect without retyping on a remote.
 *
 * The password is stored in clear text. It is private to this app and wiped on
 * uninstall, but anyone with developer-mode access to the device can read it.
 * It is kept because signing in with a D-pad is painful; signing out removes
 * it.
 */
export interface RememberedCredentials {
  serverUrl: string;
  userName: string;
  password?: string;
}

export function loadCredentials(): Promise<RememberedCredentials | undefined> {
  return readJson<RememberedCredentials>(CREDENTIALS_KEY);
}

export async function saveCredentials(credentials: RememberedCredentials): Promise<void> {
  try {
    await writeJson(CREDENTIALS_KEY, credentials);
  } catch {
    // Convenience only: failing to remember must never block signing in.
  }
}

export function clearCredentials(): Promise<void> {
  return remove(CREDENTIALS_KEY);
}

/**
 * Returns this installation's stable device id, creating one on first run.
 *
 * Jellyfin keys its device list on this value, so it must survive restarts; a
 * fresh id on every launch would fill the server's dashboard with entries.
 */
export async function loadOrCreateDeviceId(): Promise<string> {
  const stored = await readJson<{deviceId?: string}>(DEVICE_KEY);
  if (stored?.deviceId) {
    return stored.deviceId;
  }
  const deviceId = generateDeviceId();
  try {
    await writeJson(DEVICE_KEY, {deviceId});
  } catch {
    // If it cannot be persisted the app still works for this session.
  }
  return deviceId;
}

function generateDeviceId(): string {
  const chars = 'abcdef0123456789';
  let id = '';
  for (let i = 0; i < 32; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export const APP_VERSION = '0.1.0';

export function buildIdentity(deviceId: string, deviceName: string): DeviceIdentity {
  return {
    client: 'Jellyfin Vega',
    device: deviceName,
    deviceId,
    version: APP_VERSION,
  };
}
