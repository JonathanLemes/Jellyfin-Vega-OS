/**
 * Windowing settings applied to every `FlatList` in the app.
 *
 * Vega's lint rule flags lists that leave these at their defaults: on a Fire
 * TV Stick the defaults render far more off-screen artwork than the device can
 * comfortably hold, which shows up as stutter while scrolling a large library.
 */
export const LIST_PERFORMANCE_PROPS = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 12,
  windowSize: 5,
  updateCellsBatchingPeriod: 50,
  removeClippedSubviews: true,
} as const;

/** Rows are shorter, so a smaller window is enough for a horizontal shelf. */
export const SHELF_PERFORMANCE_PROPS = {
  initialNumToRender: 8,
  maxToRenderPerBatch: 8,
  windowSize: 3,
  updateCellsBatchingPeriod: 50,
  removeClippedSubviews: true,
} as const;
