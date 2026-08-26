import {decodingInfo} from '@amazon-devices/react-native-w3cmedia';
import {
  buildDeviceProfile,
  probeCapabilitiesAsync,
  type DeviceProfile,
  type ProfileCapabilities,
  type SupportProbe,
} from './deviceProfile';

/**
 * Asks the Vega media stack what it can actually decode.
 *
 * `decodingInfo` is the W3C Media Capabilities entry point; unlike
 * `canPlayType` it needs no player instance, so capabilities can be measured
 * once at start-up before anything is played.
 *
 * The representative resolutions and bitrates matter: the platform answers for
 * a concrete configuration, not a codec in the abstract, so asking about 1080p
 * is what makes the answer meaningful for this client's 1080p target.
 */
const vegaSupportProbe: SupportProbe = async (mime, kind) => {
  const configuration =
    kind === 'video'
      ? {
          type: 'file' as const,
          video: {
            contentType: mime,
            width: 1920,
            height: 1080,
            bitrate: 8_000_000,
            framerate: 30,
          },
        }
      : {
          type: 'file' as const,
          audio: {
            contentType: mime,
            channels: '6',
            bitrate: 640_000,
            samplerate: 48_000,
          },
        };

  const info = await decodingInfo(configuration as never);
  return Boolean(info?.supported);
};

/**
 * Measures the device once and builds the profile Jellyfin will be sent.
 *
 * Falls back to the conservative built-in codec list if the platform refuses
 * to answer, so playback is still possible on a device where the capability
 * API is unavailable.
 */
export async function buildMeasuredDeviceProfile(): Promise<{
  profile: DeviceProfile;
  capabilities: ProfileCapabilities;
  measured: boolean;
}> {
  try {
    const capabilities = await probeCapabilitiesAsync(vegaSupportProbe);
    return {profile: buildDeviceProfile({capabilities}), capabilities, measured: true};
  } catch {
    const profile = buildDeviceProfile();
    return {
      profile,
      capabilities: {
        videoCodecs: (profile.DirectPlayProfiles[0]?.VideoCodec ?? '').split(','),
        audioCodecs: (profile.DirectPlayProfiles[0]?.AudioCodec ?? '').split(','),
      },
      measured: false,
    };
  }
}
