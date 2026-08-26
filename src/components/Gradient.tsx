import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from '@amazon-devices/react-native-svg';

export interface GradientStop {
  /** Solid colour, e.g. `#101010`. Transparency goes in `opacity`. */
  color: string;
  /** Position along the gradient, 0..1. */
  offset: number;
  /** 0..1; kept separate from the colour because SVG stops take it that way. */
  opacity?: number;
}

interface Props {
  stops: GradientStop[];
  direction?: 'vertical' | 'horizontal';
  style?: StyleProp<ViewStyle>;
  /** Distinct per instance: SVG gradient ids share one document namespace. */
  id: string;
}

/**
 * A linear gradient overlay.
 *
 * Vega has no gradient view of its own, so this draws one with the SVG
 * renderer. It is used to darken artwork behind text, which is what makes the
 * detail screen legible over an arbitrary backdrop.
 */
export const Gradient = ({stops, direction = 'vertical', style, id}: Props) => {
  const horizontal = direction === 'horizontal';
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient
            id={id}
            x1="0"
            y1="0"
            x2={horizontal ? '1' : '0'}
            y2={horizontal ? '0' : '1'}>
            {stops.map((stop, index) => (
              <Stop
                key={index}
                offset={String(stop.offset)}
                stopColor={stop.color}
                stopOpacity={String(stop.opacity ?? 1)}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
};
