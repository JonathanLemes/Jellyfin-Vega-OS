import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Svg, {Defs, LinearGradient, Path, Stop} from '@amazon-devices/react-native-svg';
import {colors} from '../theme/theme';

interface Props {
  size?: number;
  /** Renders the wordmark next to the glyph, as on the jellyfin-web login page. */
  withWordmark?: boolean;
}

/**
 * The official Jellyfin mark.
 *
 * Paths and gradient stops are taken verbatim from jellyfin-ux's
 * `icon-transparent.svg` (CC BY-SA 4.0) so the logo is pixel-accurate rather
 * than an approximation.
 */
export const JellyfinLogo = ({size = 96, withWordmark = false}: Props) => (
  <View style={styles.row}>
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient
          id="jellyfinGradient"
          gradientUnits="userSpaceOnUse"
          x1="110.25"
          y1="213.3"
          x2="496.14"
          y2="436.09">
          <Stop offset="0" stopColor="#AA5CC3" />
          <Stop offset="1" stopColor="#00A4DC" />
        </LinearGradient>
      </Defs>
      <Path
        d="M256,201.6c-20.4,0-86.2,119.3-76.2,139.4s142.5,19.9,152.4,0S276.5,201.6,256,201.6z"
        fill="url(#jellyfinGradient)"
      />
      <Path
        d="M256,23.3c-61.6,0-259.8,359.4-229.6,420.1s429.3,60,459.2,0S317.6,23.3,256,23.3z M406.5,390.8c-19.6,39.3-281.1,39.8-300.9,0s110.1-275.3,150.4-275.3S426.1,351.4,406.5,390.8z"
        fill="url(#jellyfinGradient)"
      />
    </Svg>
    {withWordmark ? (
      <Text style={[styles.wordmark, {fontSize: size * 0.52}]}>Jellyfin</Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  row: {alignItems: 'center', flexDirection: 'row'},
  wordmark: {
    color: colors.text,
    fontWeight: '300',
    letterSpacing: 1,
    marginLeft: 16,
  },
});
