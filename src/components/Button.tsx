import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {Focusable} from './Focusable';
import {colors, radius, spacing} from '../theme/theme';

type Variant = 'primary' | 'secondary' | 'ghost';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * jellyfin-web's button styling: a solid accent-blue primary, a translucent
 * secondary, and a borderless ghost. Focus fills the button with white, which
 * is the strongest available contrast cue at TV viewing distance.
 */
export const Button = ({
  label,
  onPress,
  variant = 'secondary',
  icon,
  disabled = false,
  loading = false,
  autoFocus = false,
  style,
  testID,
}: Props) => (
  <Focusable
    accessibilityLabel={label}
    autoFocus={autoFocus}
    disabled={disabled || loading}
    onPress={onPress}
    style={style}
    testID={testID}>
    {focused => (
      <View
        style={[
          styles.base,
          variant === 'primary' && styles.primary,
          variant === 'secondary' && styles.secondary,
          variant === 'ghost' && styles.ghost,
          focused && styles.focused,
          disabled && styles.disabled,
        ]}>
        {loading ? (
          <ActivityIndicator
            color={focused ? colors.background : colors.text}
            size="small"
            style={styles.spinner}
          />
        ) : icon ? (
          <Text style={[styles.icon, focused && styles.labelFocused]}>{icon}</Text>
        ) : null}
        <Text style={[styles.label, focused && styles.labelFocused]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    )}
  </Focusable>
);

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radius.pill,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  primary: {backgroundColor: colors.accent},
  secondary: {backgroundColor: 'rgba(255, 255, 255, 0.14)'},
  ghost: {backgroundColor: 'transparent'},
  focused: {
    backgroundColor: colors.text,
    shadowColor: colors.accent,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 10,
    transform: [{scale: 1.05}],
  },
  disabled: {opacity: 0.4},
  label: {color: colors.text, fontSize: 17, fontWeight: '600'},
  labelFocused: {color: colors.background},
  icon: {color: colors.text, fontSize: 17, marginRight: spacing.sm},
  spinner: {marginRight: spacing.sm},
});
