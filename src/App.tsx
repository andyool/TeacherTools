import { Suspense, lazy, useEffect, useState } from 'react';
import type { DesktopWindowContext } from './electron-types';
import { fallbackContext } from './app/windowContext';
import { useReflectiveSurfacePointerTracking, useStableButtonLift } from './shared/surfaceEffects';
import { GlobalTooltipLayer } from './shared/tooltips';
import { ConfirmHost, LiveRegion, UndoToastHost, WindowErrorBoundary } from './shared/uiKit';
import { OverlayDot } from './windows/OverlayDot';

// The always-running overlay dot loads eagerly; every other window's code is
// split into its own chunk so the dot process never parses the widget bundle.
const ClassListBuilderWindow = lazy(() =>
  import('./windows/ClassListBuilderWindow').then((module) => ({ default: module.ClassListBuilderWindow }))
);
const TeacherPopover = lazy(() =>
  import('./windows/TeacherPopover').then((module) => ({ default: module.TeacherPopover }))
);
const WidgetPickerWindow = lazy(() =>
  import('./windows/WidgetPickerWindow').then((module) => ({ default: module.WidgetPickerWindow }))
);
const WidgetPopoutWindow = lazy(() =>
  import('./windows/WidgetPopoutWindow').then((module) => ({ default: module.WidgetPopoutWindow }))
);

export function App() {
  const [context, setContext] = useState<DesktopWindowContext | null>(null);

  useStableButtonLift();
  useReflectiveSurfacePointerTracking();

  useEffect(() => {
    if (!window.electronAPI) {
      setContext(fallbackContext);
      return;
    }

    window.electronAPI.getWindowContext().then(setContext);
  }, []);

  if (!context) {
    return null;
  }

  let content: JSX.Element;

  if (context.role === 'overlay') {
    content = <OverlayDot />;
  } else if (context.role === 'builder') {
    content = <ClassListBuilderWindow windowContext={context} />;
  } else if (context.role === 'widget-picker') {
    content = <WidgetPickerWindow />;
  } else if (context.role === 'widget-popout') {
    content = (
      <WidgetPopoutWindow
        autoSizeToContent={Boolean(context.autoSizeToContent)}
        widgetId={context.widgetId ?? null}
      />
    );
  } else {
    content = <TeacherPopover />;
  }

  return (
    <WindowErrorBoundary>
      <Suspense fallback={null}>{content}</Suspense>
      <GlobalTooltipLayer />
      <LiveRegion />
      <UndoToastHost />
      <ConfirmHost />
    </WindowErrorBoundary>
  );
}

export default App;
