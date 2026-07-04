import { useEffect, useLayoutEffect, useRef } from 'react';
import { InterfaceScaleControls, useInterfaceScaleControls } from '../app/interfaceScale';
import { useResolvedTheme, useThemePreferenceState } from '../app/theme';
import { returnToTeacherTools } from '../app/windowContext';
import type { WidgetLayout } from '../widgets/dashboard';
import { DEFAULT_WIDGET_LAYOUT, getWidgetLayoutForList, normalizeWidgetIdCollection, updateWidgetLayoutForList, useDashboardLayoutsState } from '../widgets/dashboard';
import { usePickerState } from '../widgets/picker';
import { WIDGET_DETAILS } from '../widgets/registry';

export function WidgetPickerWindow() {
  const stageRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const lastRequestedHeightRef = useRef(0);
  const [picker, setPicker] = usePickerState();
  const [dashboardLayouts, setDashboardLayouts] = useDashboardLayoutsState();
  const [themePreference] = useThemePreferenceState();
  const {
    canDecreaseInterfaceScale,
    canIncreaseInterfaceScale,
    decreaseInterfaceScale,
    increaseInterfaceScale,
    interfaceScale
  } = useInterfaceScaleControls();
  const resolvedTheme = useResolvedTheme(themePreference);
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const layout = getWidgetLayoutForList(dashboardLayouts, picker.selectedListId);
  const visibleCount = layout.order.filter((widgetId) => !layout.hidden.includes(widgetId)).length;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        returnToTeacherTools();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useLayoutEffect(() => {
    if (!window.electronAPI || !stageRef.current || !panelRef.current) {
      return;
    }

    const stage = stageRef.current;
    const panel = panelRef.current;
    let cancelled = false;

    const reportHeight = () => {
      const stageStyles = window.getComputedStyle(stage);
      const stagePadding =
        parseFloat(stageStyles.paddingTop || '0') + parseFloat(stageStyles.paddingBottom || '0');
      const desiredHeight = Math.ceil(Math.max(panel.scrollHeight, panel.offsetHeight) + stagePadding);

      if (desiredHeight === lastRequestedHeightRef.current) {
        return;
      }

      lastRequestedHeightRef.current = desiredHeight;
      window.electronAPI?.getCurrentWindowBounds().then((bounds) => {
        if (cancelled) {
          return;
        }

        window.electronAPI?.setCurrentWindowBounds({
          ...bounds,
          height: desiredHeight
        });
      });
    };

    reportHeight();

    if (typeof ResizeObserver !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(reportHeight);
    });

    resizeObserver.observe(panel);
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
    };
  }, [interfaceScale, layout.order.length, selectedList?.id, visibleCount]);

  const updateSelectedLayout = (updater: (layout: WidgetLayout) => WidgetLayout) => {
    setDashboardLayouts((current) => updateWidgetLayoutForList(current, picker.selectedListId, updater));
  };

  return (
    <main
      aria-label="Widget picker"
      className="window-stage window-stage--builder window-stage--widget-picker"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          returnToTeacherTools();
        }
      }}
      ref={stageRef}
    >
      <section
        className="panel panel--builder panel--widget-picker"
        data-theme={resolvedTheme}
        ref={panelRef}
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div aria-hidden="true" className="panel__bezel-mid" />
        <div className="panel__content">
          <header className="panel-header">
            <div className="panel-header__title">
              <span className="panel-kicker">Dashboard</span>
              <h1 className="panel-title">Widgets</h1>
            </div>
            <div className="panel-actions">
              <InterfaceScaleControls
                canDecrease={canDecreaseInterfaceScale}
                canIncrease={canIncreaseInterfaceScale}
                onDecrease={decreaseInterfaceScale}
                onIncrease={increaseInterfaceScale}
                scale={interfaceScale}
              />
              <button
                aria-label="Close widget picker"
                className="icon-button icon-button--close"
                onClick={returnToTeacherTools}
                type="button"
              >
                ×
              </button>
            </div>
          </header>

          <div className="widget-picker-window">
            <p className="helper-text">
              {selectedList
                ? `Layout for ${selectedList.name}. Drag cards in the main dashboard to reorder them.`
                : 'This layout applies when no class list is selected.'}
            </p>

            <div className="widget-toggle-list">
              {layout.order.map((widgetId) => {
                const details = WIDGET_DETAILS[widgetId];
                const visible = !layout.hidden.includes(widgetId);

                return (
                  <label className="widget-toggle" key={widgetId}>
                    <input
                      checked={visible}
                      onChange={(event) => {
                        updateSelectedLayout((current) => ({
                          ...current,
                          hidden: event.target.checked
                            ? current.hidden.filter((entry) => entry !== widgetId)
                            : normalizeWidgetIdCollection([...current.hidden, widgetId])
                        }));
                      }}
                      type="checkbox"
                    />
                    <div className="widget-toggle__copy">
                      <span className="widget-toggle__name">{details.title}</span>
                      <span className="widget-toggle__hint">
                        {details.description}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="widget-picker-window__footer">
              <button
                className="secondary-link button-tone--utility"
                onClick={() =>
                  updateSelectedLayout((current) => ({
                    ...current,
                    hidden: []
                  }))
                }
                type="button"
              >
                Show all
              </button>
              <button
                className="secondary-link"
                onClick={() => updateSelectedLayout(() => DEFAULT_WIDGET_LAYOUT)}
                type="button"
              >
                Reset layout
              </button>
              <span className="badge">{visibleCount}</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
