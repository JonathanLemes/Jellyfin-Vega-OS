import React, {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {Pressable, type StyleProp, type ViewStyle, View} from 'react-native';

export interface FocusableHandle {
  focus(): void;
}

interface Props {
  children: (focused: boolean) => React.ReactNode;
  onPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** Requests the remote's focus once, when the element first appears. */
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

type TVView = View & {requestTVFocus?: () => void};

/**
 * The single focus primitive used by every selectable element in the app.
 *
 * Centralising this matters on a TV: the render prop hands the focused flag to
 * children so each tile can draw its own focus treatment, while focus movement
 * itself stays with the platform's spatial navigation rather than being
 * reimplemented per screen.
 */
export const Focusable = forwardRef<FocusableHandle, Props>(
  ({children, onPress, onFocus, onBlur, disabled, autoFocus, style, accessibilityLabel, testID}, ref) => {
    const [focused, setFocused] = useState(false);
    const viewRef = useRef<TVView>(null);

    useImperativeHandle(ref, () => ({
      focus: () => viewRef.current?.requestTVFocus?.(),
    }));

    useEffect(() => {
      if (!autoFocus || disabled) {
        return;
      }
      // Deferred a frame: requesting focus during the first layout pass is
      // dropped, because the native view does not exist yet.
      const frame = requestAnimationFrame(() => viewRef.current?.requestTVFocus?.());
      return () => cancelAnimationFrame(frame);
    }, [autoFocus, disabled]);

    return (
      <Pressable
        ref={viewRef}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        disabled={disabled}
        focusable={!disabled}
        hasTVPreferredFocus={autoFocus}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onPress={onPress}
        style={style}
        testID={testID}>
        {children(focused)}
      </Pressable>
    );
  },
);

Focusable.displayName = 'Focusable';
