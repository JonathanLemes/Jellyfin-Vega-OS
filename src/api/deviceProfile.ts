/**
 * Device profile construction.
 *
 * Jellyfin decides between direct play and transcoding from the profile the
 * client sends with its `PlaybackInfo` request. Rather than hard-coding what a
 * Fire TV can decode, the profile is assembled by asking the Vega media stack
 * itself through `canPlayType`, so a device that lacks (say) AV1 automatically
 * gets AV1 transcoded instead of failing at playback time.
 */

export interface DirectPlayProfile {
  Container: string;
  Type: 'Video' | 'Audio';
  VideoCodec?: string;
  AudioCodec?: string;
}

export interface TranscodingProfile {
  Container: string;
  Type: 'Video' | 'Audio';
  VideoCodec?: string;
  AudioCodec: string;
  Protocol: string;
  Context: 'Streaming' | 'Static';
  MaxAudioChannels?: string;
  MinSegments?: number;
  BreakOnNonKeyFrames?: boolean;
  EnableSubtitlesInManifest?: boolean;
}

export interface SubtitleProfile {
  Format: string;
  Method: 'Embed' | 'External' | 'Encode' | 'Hls';
}

export interface CodecProfile {
  Type: 'Video' | 'VideoAudio' | 'Audio';
  Codec?: string;
  Conditions: Array<{
    Condition: string;
    Property: string;
    Value: string;
    IsRequired: boolean;
  }>;
}

export interface DeviceProfile {
  Name: string;
  MaxStreamingBitrate: number;
  MaxStaticBitrate: number;
  MusicStreamingTranscodingBitrate: number;
  DirectPlayProfiles: DirectPlayProfile[];
  TranscodingProfiles: TranscodingProfile[];
  SubtitleProfiles: SubtitleProfile[];
  CodecProfiles: CodecProfile[];
}

/** `canPlayType` returns "probably" | "maybe" | "" per the HTML spec. */
export type CanPlayType = (mime: string) => string;

/** Representative MIME strings used to probe each codec family. */
const VIDEO_CODEC_PROBES: Array<{codec: string; mimes: string[]}> = [
  {codec: 'h264', mimes: ['video/mp4; codecs="avc1.640029"']},
  {codec: 'hevc', mimes: ['video/mp4; codecs="hvc1.1.6.L123.B0"', 'video/mp4; codecs="hev1.1.6.L123.B0"']},
  {codec: 'av1', mimes: ['video/mp4; codecs="av01.0.08M.08"']},
  {codec: 'vp9', mimes: ['video/webm; codecs="vp09.00.10.08"', 'video/mp4; codecs="vp09.00.10.08"']},
  {codec: 'vp8', mimes: ['video/webm; codecs="vp8"']},
  {codec: 'mpeg2video', mimes: ['video/mp4; codecs="mpeg2video"']},
];

const AUDIO_CODEC_PROBES: Array<{codec: string; mimes: string[]}> = [
  {codec: 'aac', mimes: ['audio/mp4; codecs="mp4a.40.2"']},
  {codec: 'mp3', mimes: ['audio/mp4; codecs="mp4a.69"', 'audio/mpeg']},
  {codec: 'ac3', mimes: ['audio/mp4; codecs="ac-3"']},
  {codec: 'eac3', mimes: ['audio/mp4; codecs="ec-3"']},
  {codec: 'opus', mimes: ['audio/mp4; codecs="Opus"', 'audio/webm; codecs="opus"']},
  {codec: 'flac', mimes: ['audio/mp4; codecs="fLaC"', 'audio/flac']},
  {codec: 'vorbis', mimes: ['audio/webm; codecs="vorbis"']},
  {codec: 'dts', mimes: ['audio/mp4; codecs="dts-"']},
  {codec: 'alac', mimes: ['audio/mp4; codecs="alac"']},
];

/**
 * Codecs assumed present when probing is unavailable.
 *
 * `canPlayType` needs an initialised player; before one exists this keeps the
 * app usable with the conservative set every Fire TV generation handles.
 */
const FALLBACK_VIDEO_CODECS = ['h264', 'hevc'];
const FALLBACK_AUDIO_CODECS = ['aac', 'mp3', 'ac3', 'eac3'];

export interface ProfileCapabilities {
  videoCodecs: string[];
  audioCodecs: string[];
}

/** Probes the Vega media stack for the codecs it will accept. */
export function probeCapabilities(canPlayType?: CanPlayType): ProfileCapabilities {
  if (!canPlayType) {
    return {videoCodecs: [...FALLBACK_VIDEO_CODECS], audioCodecs: [...FALLBACK_AUDIO_CODECS]};
  }
  const supports = (mimes: string[]) =>
    mimes.some(mime => {
      try {
        const result = canPlayType(mime);
        return result === 'probably' || result === 'maybe';
      } catch {
        return false;
      }
    });

  const videoCodecs = VIDEO_CODEC_PROBES.filter(p => supports(p.mimes)).map(p => p.codec);
  const audioCodecs = AUDIO_CODEC_PROBES.filter(p => supports(p.mimes)).map(p => p.codec);

  // Never end up with an empty list: a probe that answers "" for everything
  // would otherwise force the server to transcode content it need not touch.
  return {
    videoCodecs: videoCodecs.length ? videoCodecs : [...FALLBACK_VIDEO_CODECS],
    audioCodecs: audioCodecs.length ? audioCodecs : [...FALLBACK_AUDIO_CODECS],
  };
}

/** Containers Vega can demux, per the media stack's own MIME registry. */
const VIDEO_CONTAINERS = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'ts', 'mpegts', '3gp'];
const AUDIO_CONTAINERS = ['mp3', 'aac', 'm4a', 'flac', 'ogg', 'oga', 'opus', 'wav'];

export interface ProfileOptions {
  /** Ceiling for transcoded streams, in bits per second. */
  maxStreamingBitrate?: number;
  canPlayType?: CanPlayType;
}

export function buildDeviceProfile(options: ProfileOptions = {}): DeviceProfile {
  const {maxStreamingBitrate = 20_000_000, canPlayType} = options;
  const {videoCodecs, audioCodecs} = probeCapabilities(canPlayType);

  const directPlay: DirectPlayProfile[] = VIDEO_CONTAINERS.map(container => ({
    Container: container,
    Type: 'Video' as const,
    VideoCodec: videoCodecs.join(','),
    AudioCodec: audioCodecs.join(','),
  }));
  directPlay.push(
    ...AUDIO_CONTAINERS.map(container => ({
      Container: container,
      Type: 'Audio' as const,
      AudioCodec: audioCodecs.join(','),
    })),
  );

  return {
    Name: 'Jellyfin Vega',
    MaxStreamingBitrate: maxStreamingBitrate,
    MaxStaticBitrate: 100_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: directPlay,
    TranscodingProfiles: [
      {
        // Fragmented-MP4 HLS keeps the door open for HEVC when the device has
        // it; the server falls back to H.264 on its own when it does not.
        Container: 'mp4',
        Type: 'Video',
        VideoCodec: videoCodecs.includes('hevc') ? 'hevc,h264' : 'h264',
        AudioCodec: audioCodecs.filter(c => ['aac', 'mp3', 'ac3', 'eac3'].includes(c)).join(',') || 'aac',
        Protocol: 'hls',
        Context: 'Streaming',
        MaxAudioChannels: '6',
        MinSegments: 2,
        BreakOnNonKeyFrames: true,
      },
      {
        Container: 'ts',
        Type: 'Video',
        VideoCodec: 'h264',
        AudioCodec: 'aac,mp3,ac3',
        Protocol: 'hls',
        Context: 'Streaming',
        MaxAudioChannels: '6',
        MinSegments: 2,
        BreakOnNonKeyFrames: true,
      },
      {
        Container: 'mp3',
        Type: 'Audio',
        AudioCodec: 'mp3',
        Protocol: 'http',
        Context: 'Streaming',
      },
    ],
    // Text subtitles are fetched and rendered by the app; picture-based formats
    // have no client-side renderer here, so the server burns them in.
    SubtitleProfiles: [
      {Format: 'vtt', Method: 'External'},
      {Format: 'subrip', Method: 'External'},
      {Format: 'srt', Method: 'External'},
      {Format: 'ass', Method: 'Encode'},
      {Format: 'ssa', Method: 'Encode'},
      {Format: 'pgssub', Method: 'Encode'},
      {Format: 'dvdsub', Method: 'Encode'},
    ],
    CodecProfiles: [],
  };
}
