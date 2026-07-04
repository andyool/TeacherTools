import { useEffect, useState } from 'react';
import type { DesktopWindowContext } from './electron-types';
import { fallbackContext } from './app/windowContext';
import { useReflectiveSurfacePointerTracking, useStableButtonLift } from './shared/surfaceEffects';
import { GlobalTooltipLayer } from './shared/tooltips';
import { ClassListBuilderWindow } from './windows/ClassListBuilderWindow';
import { OverlayDot } from './windows/OverlayDot';
import { TeacherPopover } from './windows/TeacherPopover';
import { WidgetPickerWindow } from './windows/WidgetPickerWindow';
import { WidgetPopoutWindow } from './windows/WidgetPopoutWindow';

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
    <>
      {content}
      <GlobalTooltipLayer />
    </>
  );
}

export default App;
