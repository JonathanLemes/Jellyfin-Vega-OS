import React, {useCallback, useRef, useState} from 'react';
import {StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle} from 'react-native';
import {Focusable, type FocusableHandle} from './Focusable';
import {colors, radius, spacing, typography} from '../theme/theme';

interface Props {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  placeholder?: string;
  /** Called when the user confirms the field with the keyboard's Done key. */
  onSubmit?: () => void;
  secure?: boolean;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A remote-friendly text field that opens the keyboard on press, not on focus.
 *
 * On Vega the on-screen keyboard opens as soon as a `TextInput` gains focus.
 * That makes a form unusable with a remote: dismissing the keyboard returns
 * focus to the same input, which immediately reopens it, so the user can never
 * move on to the next field.
 *
 * The field therefore has two states. While idle it is a focusable button
 * showing the current value, which the D-pad can move through freely. Pressing
 * OK mounts a real `TextInput` and focuses it, opening the keyboard exactly
 * once. Finishing unmounts the input again — so there is nothing left to
 * re-trigger the keyboard — and returns focus to the button.
 */
export const TextField = ({
  value,
  onChangeText,
  label,
  placeholder,
  onSubmit,
  secure = false,
  autoFocus = false,
  style,
}: Props) => {
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  const buttonRef = useRef<FocusableHandle>(null);
  // Guards against `onBlur` and `onSubmitEditing` both ending the edit.
  const finishing = useRef(false);

  const finish = useCallback(
    (submitted: boolean) => {
      if (finishing.current) {
        return;
      }
      finishing.current = true;
      setEditing(false);
      // Hand focus back to the button so the D-pad keeps working, and only
      // then report submission.
      requestAnimationFrame(() => {
        buttonRef.current?.focus();
        finishing.current = false;
        if (submitted) {
          onSubmit?.();
        }
      });
    },
    [onSubmit],
  );

  const display = secure && value ? '•'.repeat(value.length) : value;

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      {editing ? (
        <View style={[styles.wrapper, styles.wrapperEditing]}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onBlur={() => finish(false)}
            onChangeText={onChangeText}
            onSubmitEditing={() => finish(true)}
            placeholder={placeholder}
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            secureTextEntry={secure}
            style={styles.input}
            value={value}
          />
        </View>
      ) : (
        <Focusable
          accessibilityLabel={label ?? placeholder}
          autoFocus={autoFocus}
          onBlur={() => setFocused(false)}
          onFocus={() => setFocused(true)}
          onPress={() => setEditing(true)}
          ref={buttonRef}>
          {() => (
            <View style={[styles.wrapper, focused && styles.wrapperFocused]}>
              <Text
                numberOfLines={1}
                style={[styles.value, !value && styles.placeholder]}>
                {display || placeholder || ' '}
              </Text>
            </View>
          )}
        </Focusable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  label: {...typography.caption, marginBottom: spacing.xs},
  wrapper: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 56,
  },
  wrapperFocused: {
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.7,
    shadowRadius: 10,
  },
  wrapperEditing: {borderColor: colors.accentBright},
  input: {
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  value: {
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  placeholder: {color: colors.textTertiary},
});
