import { createContext, useContext } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { ThemeMode } from './theme';
import { usePersistentState } from '../shared/persistence';
import { clampNumber } from '../shared/utils';
import type { WidgetId } from '../widgets/registry';
import { WIDGET_DETAILS, WIDGET_IDS } from '../widgets/registry';

export type ColorModeSwatchId =
  | 'sand'
  | 'apricot'
  | 'coral'
  | 'gold'
  | 'mint'
  | 'teal'
  | 'sky'
  | 'ocean'
  | 'lavender'
  | 'berry';

export type ColorModeSwatch = {
  id: ColorModeSwatchId;
  label: string;
  panelBorder: string;
  panelBottom: string;
  panelTop: string;
  widgetBorder: string;
  widgetFill: string;
  widgetHighlight: string;
  widgetInk: string;
};

export type ColorModePreferences = {
  backgroundColorId: ColorModeSwatchId;
  widgetColorsByWidgetId: Record<WidgetId, ColorModeSwatchId>;
};

export type ColorModePaletteTarget =
  | {
      anchorRect: DOMRect;
      kind: 'background';
    }
  | {
      anchorRect: DOMRect;
      kind: 'widget';
      widgetId: WidgetId;
    };

export type ColorModeAppearanceContextValue = {
  preferences: ColorModePreferences;
  theme: ThemeMode;
};

export const COLOR_MODE_SWATCHES: ColorModeSwatch[] = [
  {
    id: 'sand',
    label: 'Sand',
    panelTop: '#efe2c0',
    panelBottom: '#e7d4ab',
    panelBorder: '#5d4522',
    widgetFill: '#f6edd5',
    widgetBorder: '#5d4522',
    widgetHighlight: '#6b4b1d',
    widgetInk: '#2f2212'
  },
  {
    id: 'apricot',
    label: 'Apricot',
    panelTop: '#f2d1b2',
    panelBottom: '#e9b98e',
    panelBorder: '#7d4a20',
    widgetFill: '#f7e3d2',
    widgetBorder: '#7d4a20',
    widgetHighlight: '#9a5a22',
    widgetInk: '#3d2412'
  },
  {
    id: 'coral',
    label: 'Coral',
    panelTop: '#f0beb8',
    panelBottom: '#e79f96',
    panelBorder: '#82342f',
    widgetFill: '#f7dbd8',
    widgetBorder: '#82342f',
    widgetHighlight: '#a0443a',
    widgetInk: '#3f1815'
  },
  {
    id: 'gold',
    label: 'Gold',
    panelTop: '#efd88a',
    panelBottom: '#e4bd57',
    panelBorder: '#7f5b16',
    widgetFill: '#f5e7be',
    widgetBorder: '#7f5b16',
    widgetHighlight: '#9a6d12',
    widgetInk: '#36270f'
  },
  {
    id: 'mint',
    label: 'Mint',
    panelTop: '#cde6c3',
    panelBottom: '#a9d599',
    panelBorder: '#2d6234',
    widgetFill: '#e3f1dc',
    widgetBorder: '#2d6234',
    widgetHighlight: '#2f7b3f',
    widgetInk: '#17311c'
  },
  {
    id: 'teal',
    label: 'Teal',
    panelTop: '#bce3df',
    panelBottom: '#8dcfc7',
    panelBorder: '#225c60',
    widgetFill: '#daf0ee',
    widgetBorder: '#225c60',
    widgetHighlight: '#257277',
    widgetInk: '#102a2c'
  },
  {
    id: 'sky',
    label: 'Sky',
    panelTop: '#c7dcf8',
    panelBottom: '#97bdf2',
    panelBorder: '#295283',
    widgetFill: '#e0ecfc',
    widgetBorder: '#295283',
    widgetHighlight: '#2d64a7',
    widgetInk: '#14253e'
  },
  {
    id: 'ocean',
    label: 'Ocean',
    panelTop: '#b8d3ee',
    panelBottom: '#80afd9',
    panelBorder: '#21466a',
    widgetFill: '#d9e8f7',
    widgetBorder: '#21466a',
    widgetHighlight: '#295980',
    widgetInk: '#112337'
  },
  {
    id: 'lavender',
    label: 'Lavender',
    panelTop: '#ddcff7',
    panelBottom: '#b9a0eb',
    panelBorder: '#5a3b88',
    widgetFill: '#ede4fb',
    widgetBorder: '#5a3b88',
    widgetHighlight: '#6d47a4',
    widgetInk: '#29193d'
  },
  {
    id: 'berry',
    label: 'Berry',
    panelTop: '#e5c2da',
    panelBottom: '#d898c0',
    panelBorder: '#7a365b',
    widgetFill: '#f2dcec',
    widgetBorder: '#7a365b',
    widgetHighlight: '#95406d',
    widgetInk: '#341625'
  }
];

export const DEFAULT_COLOR_MODE_PREFERENCES: ColorModePreferences = {
  backgroundColorId: 'sand',
  widgetColorsByWidgetId: {
    timer: 'coral',
    picker: 'sky',
    'group-maker': 'mint',
    'seating-chart': 'ocean',
    'bell-schedule': 'teal',
    planner: 'gold',
    'homework-assessment': 'sand',
    'qr-generator': 'apricot',
    notes: 'lavender'
  }
};

export const DEFAULT_COLOR_MODE_APPEARANCE: ColorModeAppearanceContextValue = {
  preferences: DEFAULT_COLOR_MODE_PREFERENCES,
  theme: 'light'
};

export const ColorModeAppearanceContext = createContext<ColorModeAppearanceContextValue>(
  DEFAULT_COLOR_MODE_APPEARANCE
);

export const COLOR_MODE_POPOVER_WIDTH = 312;

export const COLOR_MODE_POPOVER_HEIGHT = 174;

export const COLOR_MODE_POPOVER_GAP = 14;

export function useColorModeAppearance() {
  return useContext(ColorModeAppearanceContext);
}

export function getColorModeSwatch(swatchId: ColorModeSwatchId) {
  return COLOR_MODE_SWATCHES.find((swatch) => swatch.id === swatchId) ?? COLOR_MODE_SWATCHES[0];
}

export function getColorModeWidgetStyle(
  theme: ThemeMode,
  preferences: ColorModePreferences,
  widgetId: WidgetId
): CSSProperties | undefined {
  if (theme !== 'color') {
    return undefined;
  }

  const swatch = getColorModeSwatch(preferences.widgetColorsByWidgetId[widgetId]);

  return {
    '--widget-card-fill': swatch.widgetFill,
    '--widget-card-border': swatch.widgetBorder,
    '--widget-card-shadow': hexToRgba(swatch.widgetBorder, 0.18),
    '--widget-ink': swatch.widgetInk,
    '--widget-highlight': swatch.widgetHighlight,
    '--widget-highlight-soft': hexToRgba(swatch.widgetHighlight, 0.12),
    '--widget-highlight-border': hexToRgba(swatch.widgetHighlight, 0.22),
    '--widget-highlight-border-strong': hexToRgba(swatch.widgetHighlight, 0.36)
  } as CSSProperties;
}

export function getColorModePanelStyle(
  theme: ThemeMode,
  preferences: ColorModePreferences
): CSSProperties | undefined {
  if (theme !== 'color') {
    return undefined;
  }

  const swatch = getColorModeSwatch(preferences.backgroundColorId);

  return {
    '--panel-fill': swatch.panelTop,
    '--panel-fill-top': swatch.panelTop,
    '--panel-fill-bottom': swatch.panelTop,
    '--panel-border': swatch.panelBorder,
    '--panel-bottom-edge': hexToRgba(swatch.panelBorder, 0.18)
  } as CSSProperties;
}

export function getColorModePopoverPosition(anchorRect: DOMRect) {
  const viewportPadding = 12;
  const canPlaceRight =
    anchorRect.right + COLOR_MODE_POPOVER_GAP + COLOR_MODE_POPOVER_WIDTH <=
    window.innerWidth - viewportPadding;
  const left = canPlaceRight
    ? anchorRect.right + COLOR_MODE_POPOVER_GAP
    : Math.max(viewportPadding, anchorRect.left - COLOR_MODE_POPOVER_GAP - COLOR_MODE_POPOVER_WIDTH);

  return {
    left,
    side: canPlaceRight ? ('right' as const) : ('left' as const),
    top: clampNumber(
      anchorRect.top,
      viewportPadding,
      Math.max(viewportPadding, window.innerHeight - COLOR_MODE_POPOVER_HEIGHT - viewportPadding)
    )
  };
}

export function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.trim().replace('#', '');
  const fullHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((channel) => `${channel}${channel}`)
          .join('')
      : normalized;

  if (fullHex.length !== 6) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  const red = Number.parseInt(fullHex.slice(0, 2), 16);
  const green = Number.parseInt(fullHex.slice(2, 4), 16);
  const blue = Number.parseInt(fullHex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function ColorModePalette({
  backgroundColorId,
  onBackgroundColorChange,
  onWidgetColorChange,
  popoverRef,
  target,
  widgetColorId
}: {
  backgroundColorId: ColorModeSwatchId;
  onBackgroundColorChange: (swatchId: ColorModeSwatchId) => void;
  onWidgetColorChange: (swatchId: ColorModeSwatchId) => void;
  popoverRef: (element: HTMLElement | null) => void;
  target: ColorModePaletteTarget;
  widgetColorId: ColorModeSwatchId | null;
}) {
  const position = getColorModePopoverPosition(target.anchorRect);
  const isWidgetTarget = target.kind === 'widget';
  const title = isWidgetTarget ? WIDGET_DETAILS[target.widgetId].title : 'Dashboard background';

  return (
    <aside
      aria-label={`Colour options for ${title}`}
      className={`color-mode-popover color-mode-popover--${position.side}`}
      ref={popoverRef}
      style={
        {
          left: `${position.left}px`,
          top: `${position.top}px`
        } as CSSProperties
      }
    >
      <div className="color-mode-popover__header">
        <span className="color-mode-popover__kicker">Colour mode</span>
        <strong className="color-mode-popover__title">{title}</strong>
      </div>

      {isWidgetTarget && widgetColorId ? (
        <div className="color-mode-popover__section">
          <span className="color-mode-popover__label">Widget</span>
          <div className="color-mode-popover__swatches">
            {COLOR_MODE_SWATCHES.map((swatch) => (
              <ColorModeSwatchButton
                appearance="widget"
                isSelected={widgetColorId === swatch.id}
                key={`widget-${swatch.id}`}
                label={`Set ${title} to ${swatch.label}`}
                onClick={() => onWidgetColorChange(swatch.id)}
                swatch={swatch}
              />
            ))}
          </div>
        </div>
      ) : null}

      {!isWidgetTarget ? (
        <div className="color-mode-popover__section">
          <span className="color-mode-popover__label">Background</span>
          <div className="color-mode-popover__swatches">
            {COLOR_MODE_SWATCHES.map((swatch) => (
              <ColorModeSwatchButton
                appearance="background"
                isSelected={backgroundColorId === swatch.id}
                key={`background-${swatch.id}`}
                label={`Set background to ${swatch.label}`}
                onClick={() => onBackgroundColorChange(swatch.id)}
                swatch={swatch}
              />
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export function ColorModeSwatchButton({
  appearance,
  isSelected,
  label,
  onClick,
  swatch
}: {
  appearance: 'background' | 'widget';
  isSelected: boolean;
  label: string;
  onClick: () => void;
  swatch: ColorModeSwatch;
}) {
  const previewStyle =
    appearance === 'background'
      ? {
          background: swatch.panelTop,
          boxShadow: `inset 0 0 0 1px ${hexToRgba(swatch.panelBorder, 0.24)}`
        }
      : {
          background: swatch.widgetFill,
          boxShadow: `inset 0 0 0 1px ${hexToRgba(swatch.widgetBorder, 0.22)}`
        };

  return (
    <button
      aria-label={label}
      aria-pressed={isSelected}
      className={`color-mode-popover__swatch ${isSelected ? 'color-mode-popover__swatch--selected' : ''}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className="color-mode-popover__swatch-preview" style={previewStyle} />
    </button>
  );
}

export function ColorModeTriggerButton({
  active,
  appearance,
  label,
  onClick,
  swatchId,
  variant
}: {
  active: boolean;
  appearance: 'background' | 'widget';
  label: string;
  onClick: (event: ReactPointerEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>) => void;
  swatchId: ColorModeSwatchId;
  variant: 'toolbar' | 'widget';
}) {
  const swatch = getColorModeSwatch(swatchId);
  const previewStyle =
    appearance === 'background'
      ? {
          background: swatch.panelTop,
          boxShadow: `inset 0 0 0 1px ${hexToRgba(swatch.panelBorder, 0.24)}`
        }
      : {
          background: swatch.widgetFill,
          boxShadow: `inset 0 0 0 1px ${hexToRgba(swatch.widgetBorder, 0.22)}`
        };
  const className =
    variant === 'toolbar'
      ? `toolbar-link button-tone--utility color-mode-trigger color-mode-trigger--toolbar ${
          active ? 'color-mode-trigger--active' : ''
        }`
      : `widget-icon-button button-tone--utility color-mode-trigger color-mode-trigger--widget ${
          active ? 'color-mode-trigger--active' : ''
        }`;

  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={className}
      data-color-mode-trigger={variant}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      title={label}
      type="button"
    >
      <span
        aria-hidden="true"
        className="color-mode-trigger__preview"
        style={previewStyle}
      />
      {variant === 'toolbar' ? <span className="color-mode-trigger__text">Background</span> : null}
    </button>
  );
}

export function useColorModePreferencesState() {
  return usePersistentState<ColorModePreferences>(
    'teacher-tools.color-mode-preferences',
    DEFAULT_COLOR_MODE_PREFERENCES,
    {
      normalize: normalizeColorModePreferences
    }
  );
}

export function normalizeColorModePreferences(raw: unknown, initialValue: ColorModePreferences) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    backgroundColorId?: unknown;
    widgetColorsByWidgetId?: Record<string, unknown>;
  };
  const rawWidgetColors =
    nextRaw.widgetColorsByWidgetId && typeof nextRaw.widgetColorsByWidgetId === 'object'
      ? nextRaw.widgetColorsByWidgetId
      : null;
  const widgetColorsByWidgetId = {} as Record<WidgetId, ColorModeSwatchId>;

  for (const widgetId of WIDGET_IDS) {
    const rawSwatchId = rawWidgetColors?.[widgetId];
    widgetColorsByWidgetId[widgetId] =
      typeof rawSwatchId === 'string' && isColorModeSwatchId(rawSwatchId)
        ? rawSwatchId
        : initialValue.widgetColorsByWidgetId[widgetId];
  }

  return {
    backgroundColorId:
      typeof nextRaw.backgroundColorId === 'string' && isColorModeSwatchId(nextRaw.backgroundColorId)
        ? nextRaw.backgroundColorId
        : initialValue.backgroundColorId,
    widgetColorsByWidgetId
  };
}

export function isColorModeSwatchId(value: string): value is ColorModeSwatchId {
  return COLOR_MODE_SWATCHES.some((swatch) => swatch.id === value);
}
