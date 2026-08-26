/**
 * Visual constants mirroring the jellyfin-web "Dark" theme.
 *
 * Values are taken from jellyfin-web's theme stylesheet so that the TV client
 * reads as the same product as the browser client. Sizes are scaled up from
 * the web defaults because this UI is viewed from across a room.
 */

export const colors = {
  /** jellyfin-web --theme-body-background */
  background: '#101010',
  backgroundElevated: '#181818',
  /** jellyfin-web card background */
  card: '#202020',
  cardHighlight: '#2a2a2a',

  /** Jellyfin brand blue, --theme-primary-color */
  accent: '#00a4dc',
  accentBright: '#33b8e5',
  /** Jellyfin brand purple, the other end of the logo gradient */
  purple: '#aa5cc3',

  text: '#ffffff',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textTertiary: 'rgba(255, 255, 255, 0.45)',
  textOnAccent: '#ffffff',

  border: 'rgba(255, 255, 255, 0.12)',
  overlay: 'rgba(0, 0, 0, 0.72)',
  scrim: 'rgba(16, 16, 16, 0.92)',

  danger: '#cc3333',
  success: '#4caf50',
  /** Watched-progress bar under a poster */
  progress: '#00a4dc',
  progressTrack: 'rgba(255, 255, 255, 0.25)',
} as const;

/** Fire TV panels overscan; keep interactive content inside this inset. */
export const safeArea = {
  horizontal: 48,
  vertical: 27,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

export const typography = {
  hero: {fontSize: 44, fontWeight: '700' as const, color: colors.text},
  title: {fontSize: 30, fontWeight: '600' as const, color: colors.text},
  sectionTitle: {fontSize: 22, fontWeight: '600' as const, color: colors.text},
  body: {fontSize: 17, fontWeight: '400' as const, color: colors.text},
  bodySecondary: {fontSize: 17, fontWeight: '400' as const, color: colors.textSecondary},
  caption: {fontSize: 14, fontWeight: '400' as const, color: colors.textSecondary},
  label: {fontSize: 15, fontWeight: '600' as const, color: colors.text},
} as const;

/** Poster geometry. 2:3 is the aspect Jellyfin uses for movie/series posters. */
export const poster = {
  width: 176,
  height: 264,
  /** 16:9 artwork used for episodes and "Continue Watching". */
  wideWidth: 300,
  wideHeight: 169,
} as const;

/**
 * The focus treatment applied to every selectable tile.
 *
 * jellyfin-web scales the card and adds a light ring; on a TV the ring needs
 * to be brighter because it is the only cue for where the remote is pointing.
 */
export const focusRing = {
  borderColor: colors.text,
  borderWidth: 3,
  shadowColor: colors.accent,
  shadowOffset: {width: 0, height: 0},
  shadowOpacity: 0.9,
  shadowRadius: 14,
  elevation: 12,
} as const;

export const focusScale = 1.08;
