const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceStudio', {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: state => ipcRenderer.invoke('state:save', state),
  importAsset: (name, bytes) => ipcRenderer.invoke('asset:save', { name, bytes }),
  readLocalAsset: filePath => ipcRenderer.invoke('asset:read', filePath),
  choosePath: options => ipcRenderer.invoke('dialog:choose-path', options),
  saveCopy: options => ipcRenderer.invoke('dialog:save-copy', options),
  saveBytes: options => ipcRenderer.invoke('dialog:save-bytes', options),
  runLocalJob: request => ipcRenderer.invoke('engine:run', request),
  probeRuntime: settings => ipcRenderer.invoke('engine:probe', settings),
  cancelJob: jobId => ipcRenderer.invoke('engine:cancel', jobId),
  openDataFolder: () => ipcRenderer.invoke('shell:show-data-folder'),
  openWidget: () => ipcRenderer.invoke('widget:open'),
  closeWidget: () => ipcRenderer.invoke('widget:close'),
  copyText: text => ipcRenderer.invoke('widget:copy-text', text),
  onProgress: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('engine:progress', listener);
    return () => ipcRenderer.removeListener('engine:progress', listener);
  }
});
