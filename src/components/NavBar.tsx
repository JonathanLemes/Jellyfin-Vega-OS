import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {Focusable} from './Focusable';
import {JellyfinLogo} from './JellyfinLogo';
import {colors, radius, safeArea, spacing} from '../theme/theme';

export interface NavTab {
  key: string;
  label: string;
}

interface Props {
  tabs: NavTab[];
  activeKey?: string;
  onSelect: (key: string) => void;
  userName?: string;
}

/**
 * The jellyfin-web header adapted for a remote: brand mark on the left, one
 * tab per library, then Search and Settings.
 *
 * Trapping focus left/right keeps arrow keys inside the bar; down moves into
 * the page content.
 */
export const NavBar = ({tabs, activeKey, onSelect, userName}: Props) => (
  <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight style={styles.bar}>
    <View style={styles.brand}>
      <JellyfinLogo size={34} />
    </View>

    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabs}>
      {tabs.map(tab => (
        <Focusable
          accessibilityLabel={tab.label}
          key={tab.key}
          onPress={() => onSelect(tab.key)}
          style={styles.tabWrapper}>
          {focused => (
            <View style={[styles.tab, focused && styles.tabFocused]}>
              <Text
                numberOfLines={1}
                style={[
                  styles.tabLabel,
                  activeKey === tab.key && styles.tabLabelActive,
                  focused && styles.tabLabelFocused,
                ]}>
                {tab.label}
              </Text>
              {activeKey === tab.key ? <View style={styles.activeUnderline} /> : null}
            </View>
          )}
        </Focusable>
      ))}
    </ScrollView>

    {userName ? (
      <View style={styles.user}>
        <Text style={styles.userName} numberOfLines={1}>
          {userName}
        </Text>
      </View>
    ) : null}
  </TVFocusGuideView>
);

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    backgroundColor: colors.backgroundElevated,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: safeArea.horizontal,
    paddingVertical: spacing.sm,
  },
  brand: {marginRight: spacing.lg},
  tabs: {alignItems: 'center'},
  tabWrapper: {marginRight: spacing.xs},
  tab: {
    alignItems: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tabFocused: {backgroundColor: colors.text},
  tabLabel: {color: colors.textSecondary, fontSize: 16, fontWeight: '600'},
  tabLabelActive: {color: colors.text},
  tabLabelFocused: {color: colors.background},
  activeUnderline: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    height: 3,
    marginTop: 4,
    width: '70%',
  },
  user: {marginLeft: spacing.md, maxWidth: 200},
  userName: {color: colors.textSecondary, fontSize: 15},
});
