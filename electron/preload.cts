import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld('electronAPI', {
  getWindowContext: () => ipcRenderer.invoke('window:get-context'),
  getOverlayBounds: () => ipcRenderer.invoke('window:get-overlay-bounds'),
  getCurrentWindowBounds: () => ipcRenderer.invoke('window:get-current-bounds'),
  getOpenWidgetPopouts: () => ipcRenderer.invoke('widget-popout:get-open-ids'),
  getAppUpdateState: () => ipcRenderer.invoke('app-update:get-state'),
  checkForAppUpdates: () => ipcRenderer.invoke('app-update:check'),
  installAppUpdate: () => ipcRenderer.invoke('app-update:install'),
  openAppUpdateDownload: () => ipcRenderer.invoke('app-update:open-download'),
  onAppUpdateStateChanged: (listener: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => {
      listener(state);
    };

    ipcRenderer.on('app-update:state', handler);
    return () => {
      ipcRenderer.removeListener('app-update:state', handler);
    };
  },
  getPersistentState: (key: string) => ipcRenderer.sendSync('storage:get', key),
  setPersistentState: (key: string, value: unknown) => ipcRenderer.invoke('storage:set', key, value),
  onPersistentStateChanged: (listener: (change: { key: string; value: unknown }) => void) => {
    const handler = (_event: unknown, change: { key: string; value: unknown }) => {
      listener(change);
    };

    ipcRenderer.on('storage:changed', handler);
    return () => {
      ipcRenderer.removeListener('storage:changed', handler);
    };
  },
  setOverlayPosition: (position: { x: number; y: number }) =>
    ipcRenderer.send('window:set-overlay-position', position),
  setCurrentWindowBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('window:set-current-bounds', bounds),
  togglePopover: () => ipcRenderer.send('popover:toggle'),
  closePopover: () => ipcRenderer.send('popover:close'),
  toggleClassListBuilder: () => ipcRenderer.send('builder:toggle'),
  closeClassListBuilder: () => ipcRenderer.send('builder:close'),
  toggleWidgetPicker: () => ipcRenderer.send('widget-picker:toggle'),
  closeWidgetPicker: () => ipcRenderer.send('widget-picker:close'),
  toggleWidgetPopout: (widgetId: string) => ipcRenderer.send('widget-popout:toggle', widgetId),
  onWidgetPopoutsChanged: (listener: (widgetIds: string[]) => void) => {
    const handler = (_event: unknown, widgetIds: string[]) => {
      listener(widgetIds);
    };

    ipcRenderer.on('widget-popout:state', handler);
    return () => {
      ipcRenderer.removeListener('widget-popout:state', handler);
    };
  },
  selectLessonDocuments: () => ipcRenderer.invoke('lesson-documents:select'),
  openLessonDocument: (filePath: string) => ipcRenderer.invoke('lesson-documents:open', filePath),
  quitApp: () => ipcRenderer.send('app:quit')
});
