import type {MediaStream} from '../api/types';

/**
 * Jellyfin's index for "no subtitles". Sending it explicitly matters: leaving
 * the index out makes the server pick its default track again, so turning
 * subtitles off would be undone by the next stream request.
 */
export const NO_SUBTITLE = -1;

/** True when the server has to burn this track into the video. */
export function isBurnedIn(track: MediaStream | undefined): boolean {
  if (!track) {
    return false;
  }
  if (track.DeliveryMethod) {
    return track.DeliveryMethod === 'Encode';
  }
  return track.IsTextSubtitleStream === false;
}

/** True when the transcoding URL asks the server to burn subtitles in. */
export function streamBurnsSubtitles(url: string): boolean {
  return /[?&]SubtitleMethod=Encode(?:&|$)/i.test(url);
}

/**
 * Whether switching to `nextIndex` needs a new stream from the server.
 *
 * Client-rendered tracks switch instantly. Anything involving a burned-in track
 * -- picking one, or leaving one -- changes the video itself. Only checking the
 * track being picked was the bug: with a burned-in default, choosing another
 * track or "Off" left the old subtitles painted on the picture.
 */
export function needsNewStream(
  tracks: MediaStream[],
  currentStreamBurnsSubtitles: boolean,
  nextIndex: number,
): boolean {
  if (currentStreamBurnsSubtitles) {
    return true;
  }
  return isBurnedIn(tracks.find(t => t.Index === nextIndex));
}
