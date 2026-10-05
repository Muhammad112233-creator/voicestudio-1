# Security and privacy

VoiceStudio is designed to process user-selected files locally. The packaged renderer has a restrictive Content Security Policy (`connect-src 'none'`), Electron uses context isolation and a sandboxed preload, and there is no analytics, account, API-key, or remote-inference implementation.

## Scope and limits

- Optional Python packages and model weights are not bundled or installed by this app. Install and verify them yourself; package managers and model hosts may contact the internet during a separate, deliberate setup step.
- At runtime, transcription loads a user-selected local faster-whisper model with `local_files_only=True`. Piper/XTTS and Argos are invoked only with local programs, files, and installed language packages.
- Imported media, voice references, transcripts rendered in the current session, and outputs can contain sensitive information. The app stores imports, job outputs and settings in the operating system's VoiceStudio user-data folder. Delete that folder when you want to remove the local copies.
- The voice-consent checkbox is a reminder, not identity or legal verification. Only use a voice sample with explicit permission. Do not use generated audio to impersonate, defraud, or mislead.
- No model can be promised to reproduce a person with 100% accuracy. The app does not include anti-spoofing or biometric safeguards.

## Reporting a vulnerability

Please do not publish private recordings, model files, credentials, or personally identifying sample data in an issue. Report security concerns through GitHub's private vulnerability reporting for the repository, if enabled, or open a minimal issue containing only a safe reproduction. Do not include model weights or private media.
