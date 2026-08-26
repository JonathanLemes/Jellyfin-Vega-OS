import * as FileSystem from '@amazon-devices/expo-file-system';
import type {DeviceIdentity, Session} from '../api/types';

/**
 * Persistence for the signed-in session, the device identity, and the
 * remembered sign-in details.
 *
 * `expo-file-system` is used because the two more obvious choices do not work
 * on Vega OS 1.2:
 *
 * - `@amazon-devices/kepler-file-system` fails every `readFileAsString` and
 *   `writeStringToFile` with `com.amazon.kepler.io.IoError`, for every path and
 *   every open mode. Only `exists`, `getEntries` and `openFile` work, which is
 *   enough to create an empty file and list it, but not to store anything.
 * - `AsyncStorage` from the Kepler runtime accepts writes and reads them back
 *   within a session, but the data does not survive a restart, so it behaves as
 *   an in-memory cache.
 *
 * `expo-file-system` writes into `/data`, the app's private directory, and was
 * verified to survive terminating and relaunching the app. It is cleared when
 * the app is uninstalled.
 */
const SESSION_FILE = 'session.json';
const DEVICE_FILE = 'device.json';
const CREDENTIALS_FILE = 'credentials.json';

function pathFor(name: string): string {
  return `${FileSystem.documentDirectory ?? '/data/'}${name}`;
}

async function readJson<T>(name: string): Promise<T | undefined> {
  try {
    const raw = await FileSystem.readAsStringAsync(pathFor(name));
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    // Missing, corrupt, or unreadable: the app starts at the sign-in screen
    // rather than failing to launch.
    return undefined;
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await FileSystem.writeAsStringAsync(pathFor(name), JSON.stringify(value));
}

async function remove(name: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(pathFor(name), {idempotent: true});
  } catch {
    // Nothing actionable: the in-memory state is dropped regardless.
  }
}

export function loadSession(): Promise<Session | undefined> {
  return readJson<Session>(SESSION_FILE);
}

export async function saveSession(session: Session): Promise<void> {
  await writeJson(SESSION_FILE, session);
}

export function clearSession(): Promise<void> {
  return remove(SESSION_FILE);
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
  return readJson<RememberedCredentials>(CREDENTIALS_FILE);
}

export async function saveCredentials(credentials: RememberedCredentials): Promise<void> {
  try {
    await writeJson(CREDENTIALS_FILE, credentials);
  } catch {
    // Convenience only: failing to remember must never block signing in.
  }
}

export function clearCredentials(): Promise<void> {
  return remove(CREDENTIALS_FILE);
}

/**
 * Returns this installation's stable device id, creating one on first run.
 *
 * Jellyfin keys its device list on this value, so it must survive restarts; a
 * fresh id on every launch would fill the server's dashboard with entries.
 */
export async function loadOrCreateDeviceId(): Promise<string> {
  const stored = await readJson<{deviceId?: string}>(DEVICE_FILE);
  if (stored?.deviceId) {
    return stored.deviceId;
  }
  const deviceId = generateDeviceId();
  try {
    await writeJson(DEVICE_FILE, {deviceId});
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
