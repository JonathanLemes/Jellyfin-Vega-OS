import {useCallback, useMemo, useState} from 'react';
import type {Route} from './routes';

export interface Navigation {
  stack: Route[];
  current: Route;
  push(route: Route): void;
  /** Replaces the whole stack, used when jumping back to the home tab. */
  reset(route: Route): void;
  /** Returns false when already at the root, so callers can exit the app. */
  pop(): boolean;
}

export function useNavigation(initial: Route = {name: 'home'}): Navigation {
  const [stack, setStack] = useState<Route[]>([initial]);

  const push = useCallback((route: Route) => {
    setStack(prev => [...prev, route]);
  }, []);

  const reset = useCallback((route: Route) => {
    setStack([route]);
  }, []);

  const pop = useCallback(() => {
    let popped = false;
    setStack(prev => {
      if (prev.length <= 1) {
        return prev;
      }
      popped = true;
      return prev.slice(0, -1);
    });
    return popped;
  }, []);

  // `pop` reports from the state updater, which React may run asynchronously;
  // the length check here is what callers can rely on synchronously.
  const canPop = stack.length > 1;

  return useMemo(
    () => ({
      stack,
      current: stack[stack.length - 1],
      push,
      reset,
      pop: () => {
        if (!canPop) {
          return false;
        }
        pop();
        return true;
      },
    }),
    [stack, push, reset, pop, canPop],
  );
}
