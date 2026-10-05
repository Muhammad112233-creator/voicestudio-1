# Architecture notes

## Process separation

- `main.cjs` owns Electron windows, local file dialogs, the private app-data folder, the small always-on-top widget, and the optional system hotkey.
- `preload.cjs` exposes a narrow `window.voiceStudio` API. The renderer has no Node integration and cannot access arbitrary filesystem paths directly.
- `renderer.js` implements the main UI; `widget.js` implements the compact dictation window.
- `runtime/engine_bridge.py` receives one JSON request over stdin, runs optional local engines, and emits progress/result JSON lines. There is no HTTP server or cloud inference endpoint.

## Local file boundary

Imports are copied to Electron's user-data `VoiceStudio/imports` folder. Engine outputs are normally written to `VoiceStudio/outputs`; app preferences are stored in `state.json`. A few subtitle outputs from the current bridge are placed alongside their imported source in `imports`. The UI offers explicit export dialogs to copy outputs out of the app-data directory.

The preload reader accepts only paths inside the app's imports, outputs, or voices folders. Renderer HTML uses a restrictive Content Security Policy that blocks network connections. Electron navigation and new-window requests are denied unless they stay on the local `file://` app.

## Engine contract

A request has this general shape:

```json
{
  "action": "transcribe",
  "jobId": "job-example",
  "input_path": "/absolute/local/path/audio.wav",
  "outputDir": "/absolute/local/path/VoiceStudio/outputs",
  "settings": {
    "pythonPath": "python3",
    "device": "auto",
    "whisperModelPath": "/absolute/path/to/local-model"
  }
}
```

Progress lines have `{"type":"progress","progress":42,"message":"..."}`; a final line has `{"type":"result","ok":true,...}` or `{"type":"result","ok":false,"error":"..."}`. Never put API keys or network URLs in a request. Add future adapters only if they preserve the explicit local-only contract.

## Voice and user safety

The consent checkbox is not a verification service. A profile can record user-provided tags and a reference-file path, but no model weights are trained or stored by the profile itself. Reference-based synthesis passes the local sample only to the local XTTS adapter. Do not build features that imply 100% identity reproduction, bypass consent, or automatically inject generated speech into third-party apps.
