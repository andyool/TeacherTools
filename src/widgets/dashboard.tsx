import { usePersistentState } from '../shared/persistence';
import { clampNumber, isString } from '../shared/utils';
import type { WidgetId } from './registry';
import { WIDGET_IDS, isWidgetId } from './registry';

export type WidgetSizeTier = 1 | 2 | 3 | 4 | 5;

export type WidgetLayout = {
  order: WidgetId[];
  hidden: WidgetId[];
  collapsed: WidgetId[];
};

export type DashboardMetrics = {
  columnCount: number;
  gap: number;
  height: number;
};

export type DashboardColumn = {
  widgetIds: WidgetId[];
};

export type DashboardLayoutFit = {
  columns: DashboardColumn[];
  isScrollable: boolean;
  widgetSizeTiers: Partial<Record<WidgetId, WidgetSizeTier>>;
};

export type DashboardLayoutsSnapshot = {
  layoutsByListId: Record<string, WidgetLayout>;
};

export const LAYOUT_FALLBACK_KEY = '__default__';

export const DASHBOARD_COLUMN_GAP = 14;

export const DASHBOARD_SHELL_SHADOW_PAD = 12;

export const DASHBOARD_SINGLE_MAX_WIDTH = 360;

export const DASHBOARD_SINGLE_MIN_WIDTH = 184;

export const DASHBOARD_FIT_BOTTOM_PADDING = 8;

export const DASHBOARD_FIT_SCALE_MIN = 0.72;

export const WIDGET_SIZE_MIN: WidgetSizeTier = 1;

export const WIDGET_SIZE_MAX: WidgetSizeTier = 5;

export const WIDGET_TITLE_MIN_FONT_SIZE_PX = 6;

export const WIDGET_ESTIMATED_HEIGHTS: Record<WidgetId, number> = {
  timer: 300,
  picker: 252,
  'group-maker': 428,
  'seating-chart': 352,
  'bell-schedule': 312,
  planner: 624,
  'homework-assessment': 392,
  'qr-generator': 428,
  notes: 246
};

export const WIDGET_DASHBOARD_HEIGHTS: Record<WidgetId, Record<WidgetSizeTier, number>> = {
  timer: { 1: 108, 2: 150, 3: 220, 4: 266, 5: WIDGET_ESTIMATED_HEIGHTS.timer },
  picker: { 1: 114, 2: 156, 3: 198, 4: 234, 5: WIDGET_ESTIMATED_HEIGHTS.picker },
  'group-maker': { 1: 126, 2: 182, 3: 244, 4: 340, 5: WIDGET_ESTIMATED_HEIGHTS['group-maker'] },
  'seating-chart': { 1: 96, 2: 148, 3: 226, 4: 306, 5: WIDGET_ESTIMATED_HEIGHTS['seating-chart'] },
  'bell-schedule': { 1: 118, 2: 164, 3: 220, 4: 274, 5: WIDGET_ESTIMATED_HEIGHTS['bell-schedule'] },
  planner: { 1: 146, 2: 228, 3: 338, 4: 474, 5: WIDGET_ESTIMATED_HEIGHTS.planner },
  'homework-assessment': { 1: 106, 2: 162, 3: 238, 4: 332, 5: WIDGET_ESTIMATED_HEIGHTS['homework-assessment'] },
  'qr-generator': { 1: 144, 2: 208, 3: 294, 4: 368, 5: WIDGET_ESTIMATED_HEIGHTS['qr-generator'] },
  notes: { 1: 98, 2: 142, 3: 190, 4: 228, 5: WIDGET_ESTIMATED_HEIGHTS.notes }
};

export const WIDGET_COLLAPSED_DASHBOARD_HEIGHT = 52;

/* Body zoom per size tier — keep in sync with 05-widget-sizing.css. */
export const WIDGET_SIZE_TIER_ZOOM: Record<WidgetSizeTier, number> = {
  1: 0.54,
  2: 0.66,
  3: 0.8,
  4: 0.92,
  5: 1
};

export type WidgetHeightModel = {
  /* Card height minus the zoomed body: header, paddings, and gaps. */
  chromeHeight: number;
  /* Body height in its own (pre-zoom) coordinate space. */
  bodyLayoutHeight: number;
  /* Real rendered card heights, filled in as tiers get rendered. */
  measuredByTier: Partial<Record<WidgetSizeTier, number>>;
};

export type WidgetHeightModels = Partial<Record<WidgetId, WidgetHeightModel>>;

export const WIDGET_SIZE_TIER_LABELS: Record<WidgetSizeTier, string> = {
  1: 'compact',
  2: 'small',
  3: 'medium',
  4: 'large',
  5: 'full'
};

export const DEFAULT_WIDGET_LAYOUT: WidgetLayout = {
  order: [...WIDGET_IDS],
  hidden: [],
  collapsed: []
};

export const DEFAULT_DASHBOARD_LAYOUTS: DashboardLayoutsSnapshot = {
  layoutsByListId: {}
};

export function useDashboardLayoutsState() {
  return usePersistentState<DashboardLayoutsSnapshot>(
    'teacher-tools.dashboard-layouts',
    DEFAULT_DASHBOARD_LAYOUTS,
    {
      normalize: normalizeDashboardLayoutsSnapshot
    }
  );
}

export function normalizeDashboardLayoutsSnapshot(
  raw: unknown,
  initialValue: DashboardLayoutsSnapshot
) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    layoutsByListId?: Record<string, unknown>;
  };

  if (!nextRaw.layoutsByListId || typeof nextRaw.layoutsByListId !== 'object') {
    return initialValue;
  }

  const layoutsByListId: Record<string, WidgetLayout> = {};

  for (const [listId, layoutRaw] of Object.entries(nextRaw.layoutsByListId)) {
    layoutsByListId[listId] = normalizeWidgetLayout(layoutRaw);
  }

  return {
    layoutsByListId
  };
}

export function normalizeWidgetLayout(raw: unknown): WidgetLayout {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_WIDGET_LAYOUT;
  }

  const nextRaw = raw as {
    collapsed?: unknown[];
    hidden?: unknown[];
    order?: unknown[];
  };

  return {
    order: normalizeWidgetOrder(Array.isArray(nextRaw.order) ? nextRaw.order.filter(isString) : []),
    hidden: normalizeWidgetIdCollection(Array.isArray(nextRaw.hidden) ? nextRaw.hidden.filter(isString) : []),
    collapsed: normalizeWidgetIdCollection(
      Array.isArray(nextRaw.collapsed) ? nextRaw.collapsed.filter(isString) : []
    )
  };
}

export function normalizeWidgetOrder(widgetIds: string[]) {
  const seen = new Set<WidgetId>();
  const result: WidgetId[] = [];

  for (const widgetId of widgetIds) {
    if (!isWidgetId(widgetId) || seen.has(widgetId)) {
      continue;
    }

    seen.add(widgetId);
    result.push(widgetId);
  }

  for (const widgetId of WIDGET_IDS) {
    if (!seen.has(widgetId)) {
      result.push(widgetId);
    }
  }

  return result;
}

export function normalizeWidgetIdCollection(widgetIds: string[]) {
  const seen = new Set<WidgetId>();
  const result: WidgetId[] = [];

  for (const widgetId of widgetIds) {
    if (!isWidgetId(widgetId) || seen.has(widgetId)) {
      continue;
    }

    seen.add(widgetId);
    result.push(widgetId);
  }

  return result;
}

export function getDashboardLayoutKey(listId: string | null) {
  return listId ?? LAYOUT_FALLBACK_KEY;
}

export function getWidgetLayoutForList(snapshot: DashboardLayoutsSnapshot, listId: string | null) {
  const key = getDashboardLayoutKey(listId);
  return snapshot.layoutsByListId[key] ?? DEFAULT_WIDGET_LAYOUT;
}

export function updateWidgetLayoutForList(
  snapshot: DashboardLayoutsSnapshot,
  listId: string | null,
  updater: (layout: WidgetLayout) => WidgetLayout
) {
  const key = getDashboardLayoutKey(listId);
  const currentLayout = getWidgetLayoutForList(snapshot, listId);

  return {
    layoutsByListId: {
      ...snapshot.layoutsByListId,
      [key]: normalizeWidgetLayout(updater(currentLayout))
    }
  };
}

export function reorderWidgetIds(order: WidgetId[], fromId: WidgetId, toId: WidgetId) {
  const normalizedOrder = normalizeWidgetOrder(order);
  const fromIndex = normalizedOrder.indexOf(fromId);
  const toIndex = normalizedOrder.indexOf(toId);

  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return normalizedOrder;
  }

  const nextOrder = [...normalizedOrder];
  const [movedWidget] = nextOrder.splice(fromIndex, 1);
  nextOrder.splice(toIndex, 0, movedWidget);
  return nextOrder;
}

export function toggleWidgetIdInList(widgetIds: WidgetId[], widgetId: WidgetId) {
  return widgetIds.includes(widgetId)
    ? widgetIds.filter((entry) => entry !== widgetId)
    : normalizeWidgetIdCollection([...widgetIds, widgetId]);
}

export function computeDashboardMetrics(containerWidth: number, containerHeight: number): DashboardMetrics {
  const safeWidth = Math.max(containerWidth, DASHBOARD_SINGLE_MIN_WIDTH);
  const maxColumnCount = Math.max(
    1,
    Math.floor((safeWidth + DASHBOARD_COLUMN_GAP) / (DASHBOARD_SINGLE_MIN_WIDTH + DASHBOARD_COLUMN_GAP))
  );
  const targetColumnCount = Math.max(
    1,
    Math.ceil((safeWidth + DASHBOARD_COLUMN_GAP) / (DASHBOARD_SINGLE_MAX_WIDTH + DASHBOARD_COLUMN_GAP))
  );
  const columnCount = clampNumber(targetColumnCount, 1, maxColumnCount);

  return {
    columnCount,
    gap: DASHBOARD_COLUMN_GAP,
    height: Math.max(0, Math.floor(containerHeight))
  };
}

export function buildDashboardColumns({
  collapsedWidgetIds,
  columnCount,
  widgetHeightModels,
  widgetSizeTiers,
  widgetIds
}: {
  collapsedWidgetIds: WidgetId[];
  columnCount: number;
  widgetHeightModels?: WidgetHeightModels;
  widgetSizeTiers: Partial<Record<WidgetId, WidgetSizeTier>>;
  widgetIds: WidgetId[];
}) {
  if (widgetIds.length === 0) {
    return [];
  }

  const normalizedColumnCount = Math.max(1, columnCount);
  const usedColumnCount = Math.min(normalizedColumnCount, widgetIds.length);
  const widgetHeights = widgetIds.map((widgetId) =>
    getWidgetDashboardHeight(
      widgetId,
      widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX,
      collapsedWidgetIds.includes(widgetId),
      widgetHeightModels
    )
  );
  const prefixHeights = [0];

  for (const height of widgetHeights) {
    prefixHeights.push(prefixHeights[prefixHeights.length - 1] + height);
  }

  const getRunHeight = (start: number, end: number) =>
    prefixHeights[end] - prefixHeights[start] + DASHBOARD_COLUMN_GAP * (end - start - 1);

  // Widgets keep the user's order: every column is a contiguous run of that
  // order (reading order top-to-bottom, left-to-right), so a widget's position
  // stays predictable across resizes. The DP picks the split points that
  // minimize the tallest column, breaking ties toward balanced columns.
  type PartitionCell = {
    maxHeight: number;
    sumOfSquares: number;
    lastSplit: number;
  };

  const widgetCount = widgetIds.length;
  const partitions: PartitionCell[][] = Array.from({ length: usedColumnCount + 1 }, () =>
    new Array<PartitionCell>(widgetCount + 1)
  );

  for (let end = 1; end <= widgetCount; end += 1) {
    const runHeight = getRunHeight(0, end);
    partitions[1][end] = {
      maxHeight: runHeight,
      sumOfSquares: runHeight * runHeight,
      lastSplit: 0
    };
  }

  for (let columnsUsed = 2; columnsUsed <= usedColumnCount; columnsUsed += 1) {
    for (let end = columnsUsed; end <= widgetCount; end += 1) {
      let best: PartitionCell | null = null;

      for (let split = columnsUsed - 1; split < end; split += 1) {
        const previous = partitions[columnsUsed - 1][split];
        const runHeight = getRunHeight(split, end);
        const candidate: PartitionCell = {
          maxHeight: Math.max(previous.maxHeight, runHeight),
          sumOfSquares: previous.sumOfSquares + runHeight * runHeight,
          lastSplit: split
        };

        if (
          !best ||
          candidate.maxHeight < best.maxHeight ||
          (candidate.maxHeight === best.maxHeight && candidate.sumOfSquares < best.sumOfSquares)
        ) {
          best = candidate;
        }
      }

      if (best) {
        partitions[columnsUsed][end] = best;
      }
    }
  }

  const columns: DashboardColumn[] = [];
  let end = widgetCount;

  for (let columnsLeft = usedColumnCount; columnsLeft >= 1; columnsLeft -= 1) {
    const cell = partitions[columnsLeft][end];
    columns.unshift({ widgetIds: widgetIds.slice(cell.lastSplit, end) });
    end = cell.lastSplit;
  }

  while (columns.length < normalizedColumnCount) {
    columns.push({ widgetIds: [] });
  }

  return columns;
}

export function buildResponsiveDashboardLayout({
  availableHeight,
  collapsedWidgetIds,
  columnCount,
  widgetHeightModels,
  widgetIds
}: {
  availableHeight: number;
  collapsedWidgetIds: WidgetId[];
  columnCount: number;
  widgetHeightModels?: WidgetHeightModels;
  widgetIds: WidgetId[];
}): DashboardLayoutFit {
  const widgetSizeTiers: Partial<Record<WidgetId, WidgetSizeTier>> = {};

  for (const widgetId of widgetIds) {
    widgetSizeTiers[widgetId] = WIDGET_SIZE_MAX;
  }

  const buildColumns = () =>
    buildDashboardColumns({
      collapsedWidgetIds,
      columnCount,
      widgetHeightModels,
      widgetIds,
      widgetSizeTiers
    });
  const fitHeight = Math.max(0, availableHeight - DASHBOARD_FIT_BOTTOM_PADDING);
  const evaluateLayout = () => {
    const nextColumns = buildColumns();
    const heights = nextColumns.map((column) =>
      getDashboardColumnEstimatedHeight(column, widgetSizeTiers, collapsedWidgetIds, widgetHeightModels)
    );
    const maxHeight = Math.max(0, ...heights);
    const minHeight = Math.min(...heights);
    const overflow =
      fitHeight > 0
        ? Math.max(0, ...heights.map((height) => height - fitHeight))
        : maxHeight;

    return {
      columns: nextColumns,
      maxHeight,
      overflow,
      spread: heights.length > 1 ? maxHeight - minHeight : maxHeight,
      totalHeight: heights.reduce((total, height) => total + height, 0)
    };
  };
  const isBetterEvaluation = (
    nextEvaluation: ReturnType<typeof evaluateLayout>,
    currentEvaluation: ReturnType<typeof evaluateLayout>
  ) => {
    if (nextEvaluation.overflow !== currentEvaluation.overflow) {
      return nextEvaluation.overflow < currentEvaluation.overflow;
    }

    if (nextEvaluation.maxHeight !== currentEvaluation.maxHeight) {
      return nextEvaluation.maxHeight < currentEvaluation.maxHeight;
    }

    // Progress (less total height) must outrank balance: when equally tall
    // columns overflow, every single-widget shrink briefly worsens the spread
    // and a spread-first comparison would deadlock the fit loop.
    if (nextEvaluation.totalHeight !== currentEvaluation.totalHeight) {
      return nextEvaluation.totalHeight < currentEvaluation.totalHeight;
    }

    return nextEvaluation.spread < currentEvaluation.spread;
  };

  let evaluation = evaluateLayout();
  let columns = evaluation.columns;
  let guard = 0;

  while (evaluation.overflow > 0) {
    if (guard > WIDGET_IDS.length * WIDGET_SIZE_MAX * 2) {
      break;
    }

    guard += 1;

    let bestAdjustment:
      | {
          evaluation: ReturnType<typeof evaluateLayout>;
          type: 'size';
          widgetId: WidgetId;
        }
      | null = null;

    for (const widgetId of widgetIds) {
      if (
        collapsedWidgetIds.includes(widgetId) ||
        (widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX) <= WIDGET_SIZE_MIN
      ) {
        continue;
      }

      const previousTier = widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX;
      widgetSizeTiers[widgetId] = clampWidgetSizeTier(previousTier - 1);
      const nextEvaluation = evaluateLayout();
      widgetSizeTiers[widgetId] = previousTier;

      if (!isBetterEvaluation(nextEvaluation, bestAdjustment?.evaluation ?? evaluation)) {
        continue;
      }

      bestAdjustment = {
        evaluation: nextEvaluation,
        type: 'size',
        widgetId
      };
    }

    if (!bestAdjustment) {
      break;
    }

    widgetSizeTiers[bestAdjustment.widgetId] = clampWidgetSizeTier(
      (widgetSizeTiers[bestAdjustment.widgetId] ?? WIDGET_SIZE_MAX) - 1
    );

    evaluation = bestAdjustment.evaluation;
    columns = evaluation.columns;
  }

  return {
    columns,
    isScrollable: evaluation.overflow > 0,
    widgetSizeTiers
  };
}

export function getDashboardColumnEstimatedHeight(
  column: DashboardColumn,
  widgetSizeTiers: Partial<Record<WidgetId, WidgetSizeTier>>,
  collapsedWidgetIds: WidgetId[],
  widgetHeightModels?: WidgetHeightModels
) {
  if (column.widgetIds.length === 0) {
    return 0;
  }

  return column.widgetIds.reduce((total, widgetId, index) => {
    const tier = widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX;
    return (
      total +
      getWidgetDashboardHeight(widgetId, tier, collapsedWidgetIds.includes(widgetId), widgetHeightModels) +
      (index > 0 ? DASHBOARD_COLUMN_GAP : 0)
    );
  }, 0);
}

export function getWidgetDashboardHeight(
  widgetId: WidgetId,
  sizeTier: WidgetSizeTier,
  collapsed: boolean,
  heightModels?: WidgetHeightModels
) {
  if (collapsed) {
    return WIDGET_COLLAPSED_DASHBOARD_HEIGHT;
  }

  const model = heightModels?.[widgetId];

  if (!model) {
    return WIDGET_DASHBOARD_HEIGHTS[widgetId][sizeTier];
  }

  const measured = model.measuredByTier[sizeTier];

  if (measured !== undefined) {
    return measured;
  }

  return Math.max(
    WIDGET_COLLAPSED_DASHBOARD_HEIGHT,
    Math.round(model.chromeHeight + model.bodyLayoutHeight * WIDGET_SIZE_TIER_ZOOM[sizeTier])
  );
}

export function clampWidgetSizeTier(value: number): WidgetSizeTier {
  return clampNumber(Math.round(value), WIDGET_SIZE_MIN, WIDGET_SIZE_MAX) as WidgetSizeTier;
}
