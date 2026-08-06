import { useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ClipGridCell } from './ClipGridCell';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { ClipFeedItem } from '../../api/types';

const GRID_COLUMNS = 3;
const GRID_GAP = 8;

interface ClipGridProps {
  clips: ClipFeedItem[];
  hasMore: boolean;
  loadingMore: boolean;
  onPressClip: (clip: ClipFeedItem) => void;
  onShowMore: () => void;
}

/** Screen V2 (revised)'s dense 3-column thumbnail grid
 * (docs/design/clip-library-grid.md §1), replacing the old one-clip-per-
 * row `ClipCard` stack. Same data/pagination as before — only the layout
 * changed.
 *
 * Cell width is measured off this component's own rendered row width via
 * `onLayout`, not computed from `useWindowDimensions`: this grid already
 * sits inside `ClipsScreen`'s `content` container (`paddingHorizontal:
 * 20`), and on web that container in turn sits inside `AppRoot`'s
 * 480px-capped column — measuring the actual laid-out width instead of the
 * raw window width means this naturally respects both native screen width
 * *and* the web cap without duplicating either number here. */
export function ClipGrid({ clips, hasMore, loadingMore, onPressClip, onShowMore }: ClipGridProps) {
  const { t } = useTranslation('clips');
  const [rowWidth, setRowWidth] = useState(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    setRowWidth(event.nativeEvent.layout.width);
  };

  const cellWidth = rowWidth > 0 ? (rowWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS : 0;

  return (
    <View>
      <View style={styles.grid} onLayout={handleLayout}>
        {cellWidth > 0
          ? clips.map((clip) => (
              <ClipGridCell
                key={clip.clipId}
                clip={clip}
                width={cellWidth}
                onPress={() => onPressClip(clip)}
              />
            ))
          : null}
      </View>
      {hasMore ? (
        <Pressable
          accessibilityRole="button"
          onPress={onShowMore}
          disabled={loadingMore}
          style={styles.showMoreButton}
        >
          {loadingMore ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.showMoreText}>{t('v2.showMore')}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  showMoreButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  showMoreText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
});
