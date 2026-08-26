import {KeplerFileSystem as FileSystem} from '@amazon-devices/kepler-file-system';
import type {DeviceIdentity, Session} from '../api/types';

/**
 * Persistence for the signed-in session and the device identity.
 *
 * `/data` is the app's private, reboot-surviving directory in the Vega
 * sandbox. It is wiped on uninstall, which is why a reinstall asks the user to
 * sign in again.
 */
const DATA_DIR = '/data';
const SESSION_PATH = `${DATA_DIR}/session.json`;
const DEVICE_PATH = `${DATA_DIR}/device.json`;
const ENCODING = 'utf8';

/**
 * `OpenMode.WRITE` from the Kepler file-system types.
 *
 * The package's entry point re-exports only `KeplerFileSystem`, so the enum is
 * not importable without reaching into its internals; the value is stable.
 */
const OPEN_MODE_WRITE = 1;

/**
 * Creates a file if it does not exist yet.
 *
 * `writeStringToFile` does not create its target, so writing to a path for the
 * first time fails. That is why the session has to be opened before it is
 * first written.
 */
async function ensureFile(path: string): Promise<void> {
  if (await FileSystem.exists(path)) {
    return;
  }
  await FileSystem.openFile(path, OPEN_MODE_WRITE);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    if (!(await FileSystem.exists(path))) {
      return undefined;
    }
    const raw = await FileSystem.readFileAsString(path, ENCODING);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    // A corrupt or unreadable file must not stop the app from starting; the
    // user simply lands back on the sign-in screen.
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureFile(path);
  await FileSystem.writeStringToFile(path, JSON.stringify(value), ENCODING);
}

export function loadSession(): Promise<Session | undefined> {
  return readJson<Session>(SESSION_PATH);
}

export async function saveSession(session: Session): Promise<void> {
  await writeJson(SESSION_PATH, session);
}

export async function clearSession(): Promise<void> {
  try {
    if (await FileSystem.exists(SESSION_PATH)) {
      await FileSystem.removeFile(SESSION_PATH);
    }
  } catch {
    // Nothing actionable: the in-memory session is dropped regardless.
  }
}

/**
 * Returns this installation's stable device id, creating one on first run.
 *
 * Jellyfin keys its device list on this value, so it must survive restarts;
 * a fresh id on every launch would fill the server's dashboard with entries.
 */
export async function loadOrCreateDeviceId(): Promise<string> {
  const stored = await readJson<{deviceId?: string}>(DEVICE_PATH);
  if (stored?.deviceId) {
    return stored.deviceId;
  }
  const deviceId = generateDeviceId();
  try {
    await writeJson(DEVICE_PATH, {deviceId});
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
