# Optional local speech engines

VoiceStudio does not bundle Python, ML weights, fonts, voice recordings, or language packs. This keeps the source repository small and avoids silently downloading anything. You choose the engine, model, source, and license.

> **Offline guarantee:** the desktop app never downloads a model. The bridge only accepts local file/folder paths. The setup commands below are examples—not automatic app behavior. `pip install` and model acquisition may contact external hosts if you run them while online. For air-gapped use, stage and verify every package/model first, then disconnect.

## 1. Pick one Python environment

Install Python 3.10–3.12 if supported by the optional packages you choose. Create an environment outside this repository if practical, then set the Python executable in **Settings → Local engines**.

Example commands (package compatibility changes over time; check each upstream project's current instructions):

```bash
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell
# .venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
```

The application runs the interpreter you configure. It does not run `pip` or modify that environment.

## 2. Transcription and dictation: faster-whisper

Install the optional package in the selected environment:

```bash
python -m pip install faster-whisper
```

Acquire a compatible CTranslate2 faster-whisper model folder separately and point **Whisper model directory** at the folder containing its model files. Do not enter a model name/identifier: use the folder path. The bridge calls `WhisperModel(path, local_files_only=True)` and fails if the installed version cannot enforce local-only loading.

A faster-whisper model and package can be large. Choose a size your CPU/GPU and memory can handle. CUDA support depends on your OS, drivers, CTranslate2 build and model precision; CPU is the compatibility fallback. Apple Metal/MPS is not wired into this starter bridge; the MPS preference currently falls back to CPU.

## 3. General speech synthesis: Piper

Install a compatible Piper runtime in the selected environment or install a standalone Piper executable. Select the executable in Settings (or leave it blank if `piper` is on `PATH`), then choose a local `.onnx` voice file. Keep its matching sidecar config file beside it when the model distribution includes one.

Piper synthesizes with the selected installed voice. It does not learn the age/accent/emotion tags saved on a VoiceStudio profile, and it does not clone the sample attached to a profile.

## 4. Reference-conditioned synthesis: Coqui TTS / XTTS (optional)

This adapter expects a local Coqui `TTS` Python package, a compatible XTTS model directory, the matching `config.json`, and a local consented speaker/reference sample. Set the model folder and config path in Settings. In the VoiceStudio profile, attach the reference sample and select that profile for speech.

The `TTS` package and model releases have their own compatibility and license conditions. Review the [XTTS documentation](https://docs.coqui.ai/en/latest/models/xtts.html) and its linked **Coqui Public Model License** before installing or using a checkpoint. This project does not redistribute XTTS weights, promise commercial rights, or promise exact identity. Model similarity depends on the particular model, language, sample, hardware and settings.

A reference sample with no configured XTTS model is not silently sent to Piper or a remote service; the task returns a local setup error.

## 5. Translation: Argos Translate

Install the Python package and install a compatible `.argosmodel` language package **locally** using Argos's supported local package installation flow. The app does not fetch packages. Both source and target language codes must be present on the machine.

Example Python snippet for a package file you already have:

```python
import argostranslate.package
argostranslate.package.install_from_path("/absolute/path/to/local-language-pair.argosmodel")
```

Translation quality and supported language pairs depend on the installed package. This first version does not translate by calling a website or hosted API.

## 6. Dubbing and media

Install ffmpeg yourself or choose its executable in Settings. Dubbing also requires the local transcription model, an XTTS-compatible model, an authorized reference recording, and (if translating) the relevant local Argos language pack. The bridge transcribes speech, optionally translates segments, synthesizes each line, fits line duration approximately with ffmpeg tempo filters, and muxes the new track.

Limitations: source audio is muted rather than source-separated; there is no speaker diarization, background preservation, lip-sync, or studio-quality mastering. Review the exported media before use.

## 7. Documents and audiobooks

- **TXT / Markdown:** read by the app locally.
- **DOCX:** install `python-docx`; text is extracted from paragraphs and tables.
- **PDF:** install `pypdf` or PyMuPDF (`fitz`); only selectable text is extracted. Image-only/scanned pages need a separate local OCR application first.
- **Audiobook:** select Piper or XTTS, choose the voice/language, then render to WAV. Large books should be split into chapters. Every chunk is generated locally and joined; review chapter breaks and pronunciation.

Optional extraction packages:

```bash
python -m pip install python-docx pypdf
```

Install only the packages you need and only from sources you trust.

## 8. Verify runtime availability

From the repository root:

```bash
python runtime/engine_bridge.py --probe
```

This prints Python/package/ffmpeg availability. It does not download or load weights. In the desktop app, use **Settings → Check local setup**. Availability does not mean a model is configured; select the local folders separately.

## Data paths

The desktop app copies imported audio/video and voice references under Electron's `userData/VoiceStudio/imports`; job outputs are written under `userData/VoiceStudio/outputs`, and preferences in `state.json`. Use the Settings privacy panel to open the folder. The browser preview cannot launch the bridge or access this folder.

<div align="center">
## ⭐ Support the Project

If you found this tool helpful, please consider giving it a **star**! It helps others discover the project and keeps the maintainers motivated.

[![GitHub stars](https://shields.io)](https://github.com)

</div>
