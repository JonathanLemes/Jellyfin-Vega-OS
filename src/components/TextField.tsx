import React, {useState} from 'react';
import {StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle} from 'react-native';
import {colors, radius, spacing, typography} from '../theme/theme';

interface Props {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  placeholder?: string;
  onSubmit?: () => void;
  secure?: boolean;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A remote-friendly text field.
 *
 * The `TextInput` is the focusable element itself rather than being wrapped in
 * a `Pressable`. That matters on Vega: the on-screen keyboard is opened by the
 * platform when the input holds real focus, so putting a focusable wrapper
 * around it leaves the field permanently unreachable — the wrapper takes focus
 * and the keyboard never attaches.
 *
 * The app's focus ring is therefore driven from the input's own focus events.
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
  const [focused, setFocused] = useState(false);

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.wrapper, focused && styles.wrapperFocused]}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          focusable
          hasTVPreferredFocus={autoFocus}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onSubmitEditing={onSubmit}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          secureTextEntry={secure}
          style={styles.input}
          value={value}
        />
      </View>
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
  },
  wrapperFocused: {
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.7,
    shadowRadius: 10,
  },
  input: {
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
});
