import type { ElectronBridge } from './electron-types';

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}

export {};
