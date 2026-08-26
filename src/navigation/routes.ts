/**
 * Route definitions for the app's navigation stack.
 *
 * A hand-rolled stack is used instead of a navigation library: the app has a
 * small, fixed set of screens, and owning the stack directly keeps control
 * over what happens on the remote's Back key, which is the only way a TV user
 * moves backwards.
 */
export type Route =
  | {name: 'home'}
  | {name: 'library'; libraryId: string; title: string; collectionType?: string}
  | {name: 'detail'; itemId: string}
  | {name: 'search'}
  | {name: 'settings'}
  | {
      name: 'player';
      itemId: string;
      /** Resume position; omitted to start from the beginning. */
      startPositionTicks?: number;
      mediaSourceId?: string;
      audioStreamIndex?: number;
      subtitleStreamIndex?: number;
    };

export type RouteName = Route['name'];
