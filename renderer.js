(() => {
  'use strict';

  const PAGE_NAMES = {
    launchpad: 'Launchpad', 'voice-lab': 'Voice lab', dictation: 'Dictation', dubbing: 'Dubbing',
    audiobook: 'Audiobook', transcribe: 'Transcribe & translate', pitch: 'Pitch & audio',
    gallery: 'Voice gallery', projects: 'Projects & jobs', settings: 'Settings & engines'
  };
  const PICK_ACCEPT = {
    'voice-sample': 'audio/*,.wav,.mp3,.m4a,.flac,.ogg,.webm',
    'dictation-audio': 'audio/*,.wav,.mp3,.m4a,.flac,.ogg,.webm',
    'transcribe-media': 'audio/*,video/*,.wav,.mp3,.m4a,.flac,.ogg,.mp4,.mov,.mkv,.webm',
    'dub-media': 'audio/*,video/*,.wav,.mp3,.m4a,.flac,.ogg,.mp4,.mov,.mkv,.webm',
    'pitch-media': 'audio/*,.wav,.mp3,.m4a,.flac,.ogg,.webm',
    'book-text': '.txt,.md,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  const LANGUAGES = [
    ['auto', 'Auto detect'], ['en', 'English'], ['ur', 'Urdu'], ['hi', 'Hindi'], ['ar', 'Arabic'],
    ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'],
    ['ru', 'Russian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['tr', 'Turkish']
  ];
  const DEFAULT_SETTINGS = {
    theme: 'dark', pythonPath: '', device: 'auto', whisperModelPath: '', piperPath: '', piperModelPath: '',
    xttsModelPath: '', xttsConfigPath: '', ffmpegPath: ''
  };
  const defaultState = () => ({
    theme: 'dark', voices: [], selectedVoiceId: '', settings: { ...DEFAULT_SETTINGS }, jobs: [], recentFiles: []
  });

  let state = defaultState();
  let page = 'launchpad';
  let settingsTab = 'models';
  let voiceMode = 'clone';
  let voiceDraft = { name: '', age: '26-35', style: 'Feminine', accent: '', emotion: 'Warm', description: '', consent: false };
  let speechDraft = '';
  let bookText = '';
  let bookTextTranslated = '';
  let activeAssets = Object.create(null);
  let recording = null;
  let transcriptState = { text: '', translated: '', language: '', segments: [] };
  let lastGeneratedPath = '';
  let runtimeProbe = null;
  let lastProbeError = '';
  let saveQueue = Promise.resolve();
  let currentAudio = null;

  const content = document.getElementById('pageContent');
  const filePicker = document.getElementById('filePicker');
  const toastStack = document.getElementById('toastStack');
  const api = window.voiceStudio || null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function humanBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function relativeTime(value) {
    const date = new Date(value || Date.now());
    const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hr ago`;
    return date.toLocaleDateString();
  }
  function toast(message, type = 'success') {
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.innerHTML = `<span class="toast-mark">${type === 'error' ? '!' : type === 'info' ? 'i' : '✓'}</span><span>${esc(message)}</span>`;
    toastStack.appendChild(item);
    window.setTimeout(() => item.remove(), 4300);
  }
  function persist() {
    const serialized = JSON.stringify(state);
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      if (api) await api.saveState(JSON.parse(serialized));
      else localStorage.setItem('voicestudio-state', serialized);
    }).catch(error => console.warn('Local state could not be saved:', error));
    return saveQueue;
  }
  function setTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    state.settings.theme = state.theme;
    document.documentElement.dataset.theme = state.theme;
    const glyph = document.getElementById('themeGlyph');
    if (glyph) glyph.textContent = state.theme === 'dark' ? '☼' : '☾';
    persist();
  }
  function iconWave(count = 30) {
    return `<div class="waveform" aria-hidden="true">${Array.from({ length: count }, (_, i) => {
      const h = 13 + (Math.abs(Math.sin(i * 1.7) * Math.cos(i * .34)) * 72);
      const delay = (i % 7) * -.14;
      return `<i style="--h:${h.toFixed(0)}px;--delay:${delay.toFixed(2)}s;--d:${(.72 + (i % 5) * .12).toFixed(2)}s"></i>`;
    }).join('')}</div>`;
  }
  function voiceSelect(selected = state.selectedVoiceId, id = 'voiceSelect') {
    const opts = state.voices.map(v => `<option value="${esc(v.id)}" ${v.id === selected ? 'selected' : ''}>${esc(v.name)} · ${esc(v.accent || v.style || 'Local profile')}</option>`).join('');
    return `<select class="select" id="${id}"><option value="">${state.voices.length ? 'Choose a saved voice' : 'No saved voice profiles yet'}</option>${opts}</select>`;
  }
  function languageSelect(id, selected = 'en') {
    return `<select class="select" id="${id}">${LANGUAGES.filter(x => x[0] !== 'auto').map(([code, label]) => `<option value="${code}" ${code === selected ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  }
  function fileChip(asset, path = '') {
    if (!asset && !path) return '';
    const name = asset?.name || path.split(/[\\/]/).pop() || 'Local file';
    const size = asset?.size ? humanBytes(asset.size) : 'Stored on this device';
    const pathValue = asset?.path || path;
    return `<div class="file-chip"><div class="file-chip-icon">▤</div><div class="file-chip-info"><strong>${esc(name)}</strong><span>${esc(size)} · local workspace</span></div>${pathValue ? `<button class="file-remove" title="Preview file" data-play-path="${esc(pathValue)}">▶</button>` : ''}<button class="file-remove" title="Remove file" data-remove-asset="${esc(asset?.purpose || '')}">×</button></div>`;
  }
  function emptyResult(text = 'Your local results will appear here.') {
    return `<div class="result-box empty">${esc(text)}</div>`;
  }
  function settingsReady(key) { return Boolean(state.settings[key] && String(state.settings[key]).trim()); }
  function engineSummary() {
    const asr = settingsReady('whisperModelPath') && (runtimeProbe?.packages?.faster_whisper ?? false);
    const piper = settingsReady('piperModelPath') && (runtimeProbe?.packages?.piper ?? false);
    const xtts = settingsReady('xttsModelPath') && settingsReady('xttsConfigPath') && (runtimeProbe?.packages?.coqui_tts ?? false);
    if (asr || piper || xtts) return 'Some local engines ready';
    return 'Engine setup needed';
  }
  function updateChrome() {
    document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
    const crumb = document.getElementById('pageCrumb');
    if (crumb) crumb.textContent = PAGE_NAMES[page] || 'Workspace';
    const count = document.getElementById('voiceCount');
    if (count) count.textContent = String(state.voices.length);
    const runtimeBadge = document.getElementById('runtimeBadge');
    if (runtimeBadge) runtimeBadge.textContent = engineSummary();
  }

  function renderLaunchpad() {
    const activeJobs = state.jobs.filter(job => job.status === 'running').length;
    return `<div class="page-enter">
      <section class="hero-card">
        <div class="hero-copy">
          <div class="eyebrow">YOUR PRIVATE VOICE WORKSPACE</div>
          <h1>Make your voice work<br><em>for you.</em></h1>
          <p class="lede">Record, transcribe, translate and shape speech with local tools. Your files stay on this device — no account, API key or cloud upload.</p>
          <div class="hero-actions"><button class="btn btn-primary" data-page="voice-lab"><span class="btn-icon">＋</span> Create a voice profile</button><button class="btn btn-quiet" data-page="dictation"><span class="btn-icon">⌁</span> Start dictating</button></div>
          <div class="local-callout"><span>◈</span> Local processing · consent-first voice references · no telemetry</div>
        </div>
        <div class="hero-visual"><div class="sphere"></div>${iconWave(31)}<span class="orbit-label">AUDIO · ON DEVICE</span></div>
      </section>
      <div class="stat-row">
        <div class="card stat-card"><div class="stat-top"><span class="stat-label">Saved voice profiles</span><span class="stat-symbol">◌</span></div><div class="stat-value">${state.voices.length.toString().padStart(2, '0')}</div></div>
        <div class="card stat-card"><div class="stat-top"><span class="stat-label">Jobs running</span><span class="stat-symbol">↗</span></div><div class="stat-value">${activeJobs.toString().padStart(2, '0')}</div></div>
        <div class="card stat-card"><div class="stat-top"><span class="stat-label">Local engine</span><span class="stat-symbol">⌘</span></div><div class="stat-value" style="font-size:14px;letter-spacing:-.03em">${runtimeProbe?.python ? 'Connected' : 'Not set up'}</div></div>
        <div class="card stat-card"><div class="stat-top"><span class="stat-label">Cloud services</span><span class="stat-symbol" style="color:var(--mint);background:var(--mint-wash)">⌑</span></div><div class="stat-value" style="font-size:14px;letter-spacing:-.03em">Disabled</div></div>
      </div>
      <div class="section-head"><div><h2>Pick up where you want to go</h2><p>Every workflow runs locally when a compatible engine is configured.</p></div></div>
      <div class="tool-grid">
        <button class="card tool-card" data-page="voice-lab"><span class="tool-arrow">↗</span><div class="tool-icon">◉</div><h3>Voice lab</h3><p>Record a consented reference, save a voice profile and tune its attributes.</p></button>
        <button class="card tool-card" data-page="transcribe"><span class="tool-arrow">↗</span><div class="tool-icon">≋</div><h3>Transcribe & translate</h3><p>Turn local audio or video into text, then translate with installed offline language packs.</p></button>
        <button class="card tool-card" data-page="dubbing"><span class="tool-arrow">↗</span><div class="tool-icon">▣</div><h3>Dub a video</h3><p>Build a translated speech track and fit lines approximately to the source timing.</p></button>
        <button class="card tool-card" data-page="audiobook"><span class="tool-arrow">↗</span><div class="tool-icon">▤</div><h3>Make an audiobook</h3><p>Speak a document with a local voice model and save an audio file.</p></button>
        <button class="card tool-card" data-page="dictation"><span class="tool-arrow">↗</span><div class="tool-icon">⌁</div><h3>Dictation</h3><p>Record a thought or audio note and transcribe it without browser speech APIs.</p></button>
        <button class="card tool-card" data-page="pitch"><span class="tool-arrow">↗</span><div class="tool-icon">♬</div><h3>Pitch & audio</h3><p>Fine-tune pitch in 0.01-semitone increments and export a locally processed WAV.</p></button>
        <button class="card tool-card" data-page="gallery"><span class="tool-arrow">↗</span><div class="tool-icon">◌</div><h3>Voice gallery</h3><p>Keep your local voice profiles organized, searchable and ready to reuse.</p></button>
        <button class="card tool-card" data-page="settings"><span class="tool-arrow">↗</span><div class="tool-icon">⚙</div><h3>Set up engines</h3><p>Choose local model folders and hardware. VoiceStudio never fetches weights for you.</p></button>
      </div>
      <div class="lower-grid">
        <div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">A SMALL, LOCAL LOOP</div><h3 style="margin-top:7px">Your files never leave this workspace</h3></div><span class="tag" style="color:var(--mint)">NO CLOUD</span></div><div class="step-list"><div class="step"><div class="step-num">01 / IMPORT</div><strong>Choose your source</strong><span>Drop a file or record directly in the desktop app.</span></div><div class="step"><div class="step-num">02 / PROCESS</div><strong>Use local engines</strong><span>Point to models already installed on your machine.</span></div><div class="step"><div class="step-num">03 / EXPORT</div><strong>Keep the result</strong><span>Save audio, transcripts and profiles locally.</span></div></div></div>
        <div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">RECENT ACTIVITY</div><h3 style="margin-top:7px">Jobs & outputs</h3></div><button class="btn btn-small btn-quiet" data-page="projects">View all</button></div>${state.jobs.length ? recentJobsMarkup(state.jobs.slice(0, 2)) : `<div class="job-empty"><div><b>Nothing running yet</b>Your long jobs and exports will show here.</div></div>`}</div>
      </div>
      <div class="notice warning" style="margin-top:16px"><span class="notice-icon">ⓘ</span><span><strong>Voice realism, honestly.</strong> Voice models can sound similar, not 100% identical. Only clone or reproduce a voice when you have explicit permission; never present synthetic speech as a real person's recording.</span></div>
    </div>`;
  }

  function renderVoiceLab() {
    const sample = activeAssets['voice-sample'];
    const isClone = voiceMode === 'clone';
    return `<div class="page-enter">
      <div class="page-heading"><div><div class="eyebrow">VOICE LAB · PRIVATE BY DESIGN</div><h1>Create a voice profile</h1><p class="lede">Record or import a reference voice, or describe a profile for your own library. A saved profile is not itself a trained model.</p></div><div class="mode-switch"><button data-voice-mode="clone" class="${isClone ? 'active' : ''}">Clone from sample</button><button data-voice-mode="design" class="${!isClone ? 'active' : ''}">Describe a voice</button></div></div>
      <div class="two-col">
        <div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">PROFILE DETAILS</div><p class="subtle-copy" style="margin-top:5px">Keep the voice tags personal and descriptive.</p></div><span class="tag">SAVED LOCALLY</span></div>
          <div class="form-grid">
            <div class="field full"><label for="voiceName">Profile name</label><input class="input" id="voiceName" data-draft="name" placeholder="e.g. Warm narration" value="${esc(voiceDraft.name)}"></div>
            <div class="field"><label for="voiceAge">Approximate age range</label><select class="select" id="voiceAge" data-draft="age">${[['18-25','18–25'],['26-35','26–35'],['36-50','36–50'],['51-65','51–65'],['65+','65+']].map(([v,l]) => `<option value="${v}" ${voiceDraft.age === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="field"><label for="voiceStyle">Voice presentation</label><select class="select" id="voiceStyle" data-draft="style">${['Feminine','Masculine','Androgynous','Unspecified'].map(v => `<option ${voiceDraft.style === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
            <div class="field"><label for="voiceAccent">Accent / language</label><input class="input" id="voiceAccent" data-draft="accent" placeholder="e.g. Lahore Urdu, neutral English" value="${esc(voiceDraft.accent)}"></div>
            <div class="field"><label for="voiceEmotion">Delivery / emotion</label><select class="select" id="voiceEmotion" data-draft="emotion">${['Warm','Calm','Bright','Confident','Reflective','Playful','Neutral'].map(v => `<option ${voiceDraft.emotion === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
            <div class="field full"><label for="voiceDescription">Notes for this profile</label><textarea class="textarea" id="voiceDescription" data-draft="description" placeholder="Describe pacing, resonance, intended use, or pronunciation notes…">${esc(voiceDraft.description)}</textarea></div>
          </div>
          <hr class="form-divider">
          ${isClone ? `<div class="field"><div class="field-label">CONSENTED REFERENCE SAMPLE</div><p class="field-hint">A clean 10–30 second sample is a good starting point. Use only your own voice or a voice you have clear permission to use.</p></div><div class="record-box" style="margin-top:11px"><button class="record-button ${recording?.target === 'voice-sample' ? 'recording' : ''}" data-record="voice-sample" title="${recording?.target === 'voice-sample' ? 'Stop recording' : 'Record sample'}">${recording?.target === 'voice-sample' ? '■' : '●'}</button><div class="record-copy"><strong>${recording?.target === 'voice-sample' ? 'Recording voice sample…' : 'Record a short sample'}</strong><span>${sample ? `Ready: ${esc(sample.name)}` : 'Quiet room · natural speaking pace · no background music'}</span></div><button class="btn btn-small" data-pick="voice-sample">Import sample</button></div>${sample ? `<div style="margin-top:9px">${fileChip(sample)}</div>` : ''}` : `<div class="notice"><span class="notice-icon">✧</span><span>A description can organize a voice concept. Description-to-voice synthesis is not implemented in this build; it would need a compatible local model and a future adapter. Nothing is sent anywhere.</span></div>`}
          <div class="consent-row" style="margin-top:14px"><input type="checkbox" id="voiceConsent" ${voiceDraft.consent ? 'checked' : ''}><label for="voiceConsent"><strong>I have permission to use this voice.</strong> I will not use it to impersonate someone, mislead listeners, or create unauthorized copies. The sample stays in my local VoiceStudio data folder.</label></div>
          <div class="form-actions" style="margin-top:16px"><button class="btn btn-primary" data-action="save-voice"><span class="btn-icon">＋</span> Save local profile</button><button class="btn btn-quiet" data-page="gallery">Open voice gallery</button></div>
        </div>
        <div class="stack">
          <div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">TRY A LOCAL VOICE</div><h3 style="margin-top:7px">Generate a speech sample</h3></div><span class="tag">MODEL REQUIRED</span></div>
            <div class="field"><label for="voiceSelect">Saved profile</label>${voiceSelect()}</div>
            <div class="field" style="margin-top:13px"><label for="speechText">Text to speak</label><textarea class="textarea" id="speechText" placeholder="Type a short preview line…">${esc(speechDraft)}</textarea></div>
            <div class="notice warning" style="margin-top:12px"><span class="notice-icon">ⓘ</span><span>Reference-based cloning needs a locally installed XTTS-compatible model. The installed model—not the tags above—determines the actual voice. Results are approximate, never a 100% identity match.</span></div>
            <button class="btn btn-primary btn-wide" style="margin-top:14px" data-action="voice-preview">Generate with local model <span class="btn-icon">↗</span></button>
            ${lastGeneratedPath ? `<div style="margin-top:12px">${outputPreview(lastGeneratedPath, 'Last generated sample')}</div>` : ''}
          </div>
          <div class="notice safe"><span class="notice-icon">⌑</span><span><strong>No cloud model calls.</strong> VoiceStudio only launches the local Python bridge against paths you configure. It will not download model weights or send samples to a remote service.</span></div>
        </div>
      </div>
    </div>`;
  }

  function renderGallery() {
    const query = (document.getElementById('voiceSearch')?.value || '').toLowerCase();
    const voices = state.voices.filter(v => `${v.name} ${v.accent} ${v.emotion} ${v.description}`.toLowerCase().includes(query));
    const cards = voices.length ? voices.map(v => {
      const initials = v.name.trim().split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase() || 'V';
      const tags = [v.mode === 'clone' ? 'Reference voice' : 'Voice concept', v.accent, v.emotion, v.age ? `Age ${v.age}` : ''].filter(Boolean);
      return `<article class="card voice-card"><div class="voice-card-top"><div class="voice-avatar">${esc(initials)}</div><div class="voice-meta"><strong>${esc(v.name)}</strong><span>${esc(v.style || 'Unspecified')} · added ${relativeTime(v.createdAt)}</span></div><button class="voice-more" data-action="delete-voice" data-id="${esc(v.id)}" title="Delete profile">···</button></div><div class="voice-tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div><div class="voice-wave" aria-hidden="true">${Array.from({ length: 39 }, (_, i) => `<i style="--h:${(4 + Math.abs(Math.sin(i * .74) * Math.cos(i * .2)) * 19).toFixed(0)}px"></i>`).join('')}</div><div class="voice-card-actions">${v.referencePath ? `<button class="btn btn-small btn-quiet" data-play-path="${esc(v.referencePath)}">▶ Reference</button>` : `<button class="btn btn-small btn-quiet" disabled>Profile only</button>`}<button class="btn btn-small btn-primary" data-action="use-voice" data-id="${esc(v.id)}">Use voice</button></div></article>`;
    }).join('') : `<div class="empty-state"><div class="empty-orbit">◌</div><h3>${state.voices.length ? 'No matching profiles' : 'Your voice gallery is ready'}</h3><p>${state.voices.length ? 'Try a different search term.' : 'Create a consented reference profile or save a voice concept. Profiles are stored locally on this device.'}</p><button class="btn btn-primary" data-page="voice-lab">＋ Create a voice profile</button></div>`;
    return `<div class="page-enter"><div class="page-heading"><div><div class="eyebrow">YOUR LOCAL LIBRARY</div><h1>Voice gallery</h1><p class="lede">Saved profiles and consented reference samples, kept in your local app folder.</p></div><div class="voice-toolbar"><div class="search-wrap"><span class="search-icon">⌕</span><input id="voiceSearch" class="input" placeholder="Search voices…" value="${esc(query)}"></div><button class="btn btn-primary" data-page="voice-lab">＋ New profile</button></div></div><div class="voice-grid">${cards}</div><div class="notice warning" style="margin-top:18px"><span class="notice-icon">ⓘ</span><span><strong>Use responsibly.</strong> Similarity depends on the local model and recording. No system can promise an exact 100% clone; always disclose synthetic audio where listeners could be misled.</span></div></div>`;
  }

  function renderDictation() {
    const asset = activeAssets['dictation-audio'];
    return `<div class="page-enter"><div class="page-heading"><div><div class="eyebrow">SPEAK, THEN TRANSCRIBE</div><h1>Dictation</h1><p class="lede">Capture a thought in the app, or import a short recording. Transcription uses your selected local Whisper model—never browser speech recognition.</p></div><span class="tag">OFFLINE ASR</span></div><div class="two-col"><div class="stack"><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">MICROPHONE</div><p class="subtle-copy" style="margin-top:5px">Record locally in this window.</p></div><span class="tag">${recording?.target === 'dictation-audio' ? 'RECORDING' : 'READY'}</span></div><div class="recorder-surface"><div class="mic-ring ${recording?.target === 'dictation-audio' ? 'is-recording' : ''}">${recording?.target === 'dictation-audio' ? '●' : '⌁'}</div><strong>${recording?.target === 'dictation-audio' ? 'Listening on this device' : asset ? 'Recording ready' : 'Ready when you are'}</strong><p>${recording?.target === 'dictation-audio' ? 'Select Stop recording when you are done. The audio is saved only to your local app folder.' : 'Your browser mic permission is used only to capture audio in this app.'}</p><div class="recorder-actions"><button class="btn ${recording?.target === 'dictation-audio' ? 'btn-danger' : 'btn-primary'}" data-record="dictation-audio">${recording?.target === 'dictation-audio' ? '■ Stop recording' : '● Start recording'}</button><button class="btn btn-quiet" data-pick="dictation-audio">Import audio</button></div></div>${asset ? `<div style="margin-top:12px">${fileChip(asset)}</div>` : ''}<div class="notice" style="margin-top:13px"><span class="notice-icon">⌘</span><span>The mini dictation widget can float over other apps. Record, transcribe locally, then copy and paste the text into your current app. Hotkey: Ctrl/⌘ + Shift + Space.</span></div><div style="display:flex;gap:8px;margin-top:13px"><button class="btn btn-primary" data-action="dictate" ${asset?.path ? '' : 'disabled'}>Transcribe with local model <span class="btn-icon">↗</span></button><button class="btn btn-quiet" data-action="open-widget">Open mini widget</button></div></div></div><div class="stack"><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">TRANSCRIPT</div><h3 style="margin-top:6px">Your words</h3></div>${transcriptState.language ? `<span class="tag">${esc(transcriptState.language.toUpperCase())}</span>` : ''}</div>${transcriptState.text ? `<div class="result-box">${esc(transcriptState.text)}</div><div class="result-actions"><button class="btn btn-small" data-action="copy-transcript">Copy text</button><button class="btn btn-small btn-quiet" data-action="export-transcript">Export .txt</button></div>` : emptyResult('Run a local transcription to see your words here.')}</div><div class="notice warning"><span class="notice-icon">ⓘ</span><span>VoiceStudio does not use OS dictation or the browser Web Speech API, because those may send audio to a service. A local Whisper model must be set up in Settings.</span></div></div></div></div>`;
  }

  function renderTranscribe() {
    const asset = activeAssets['transcribe-media'];
    return `<div class="page-enter"><div class="page-heading"><div><div class="eyebrow">AUDIO · VIDEO · TEXT</div><h1>Transcribe & translate</h1><p class="lede">Drop in media, run a local transcription and optionally translate it with language packs already installed on this computer.</p></div><span class="tag">NO UPLOADS</span></div><div class="two-col"><div class="stack"><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">SOURCE MEDIA</div><p class="subtle-copy" style="margin-top:5px">Audio or video, imported into your local workspace.</p></div><span class="tag">DROP FILE</span></div>${asset ? fileChip(asset) : dropzone('transcribe-media', 'Drop audio or video here', 'WAV, MP3, M4A, FLAC, MP4, MOV… · processed locally')}<button class="btn btn-primary btn-wide" style="margin-top:13px" data-action="transcribe" ${asset?.path ? '' : 'disabled'}>Transcribe media <span class="btn-icon">↗</span></button><hr class="form-divider"><div class="panel-label">TRANSLATE THE TRANSCRIPT</div><p class="subtle-copy" style="margin:6px 0 12px">Uses installed Argos Translate language packs only.</p><div class="language-pair"><div class="field"><label for="translateFrom">From</label><select class="select" id="translateFrom">${LANGUAGES.map(([code,label]) => `<option value="${code}" ${code === (transcriptState.language || 'auto') ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="language-swap">→</div><div class="field"><label for="translateTo">To</label>${languageSelect('translateTo', 'en')}</div></div><button class="btn btn-wide" style="margin-top:12px" data-action="translate" ${transcriptState.text ? '' : 'disabled'}>Translate locally <span class="btn-icon">✧</span></button></div>${asset?.url && asset.kind === 'video' ? `<video controls class="preview-video" src="${asset.url}"></video>` : asset?.url ? `<audio controls class="audio-preview" src="${asset.url}"></audio>` : ''}</div><div class="stack"><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">SOURCE TRANSCRIPT</div><h3 style="margin-top:6px">Recognized speech</h3></div>${transcriptState.language ? `<span class="tag">${esc(transcriptState.language.toUpperCase())}</span>` : ''}</div>${transcriptState.text ? `<div class="result-box">${esc(transcriptState.text)}</div><div class="result-actions"><button class="btn btn-small" data-action="copy-transcript">Copy</button><button class="btn btn-small btn-quiet" data-action="export-transcript">Export .txt</button></div>` : emptyResult('Your transcription will appear here with a local Whisper model.')}</div><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">TRANSLATED TEXT</div><h3 style="margin-top:6px">Translation</h3></div></div>${transcriptState.translated ? `<div class="result-box">${esc(transcriptState.translated)}</div><div class="result-actions"><button class="btn btn-small" data-action="copy-translation">Copy</button><button class="btn btn-small btn-quiet" data-action="speak-translation">Speak translation</button></div>` : emptyResult('Run a translation after transcription to see it here.')}</div><div class="notice warning"><span class="notice-icon">ⓘ</span><span>Translation is only available for language pairs with an Argos package installed locally. VoiceStudio will not download missing packages.</span></div></div></div></div>`;
  }

  function dropzone(purpose, title, hint) {
    return `<div class="dropzone" data-drop="${esc(purpose)}"><div class="drop-icon">↥</div><strong>${esc(title)}</strong><span>${esc(hint)}</span><button class="btn btn-small" data-pick="${esc(purpose)}">Browse files</button></div>`;
  }
  function renderDubbing() {
    const asset = activeAssets['dub-media'];
    const selected = state.voices.find(v => v.id === state.selectedVoiceId);
    return `<div class="page-enter"><div class="page-heading"><div><div class="eyebrow">LOCAL VIDEO WORKFLOW</div><h1>Dub a video</h1><p class="lede">Transcribe, optionally translate and synthesize a timed speech track from local models. Line fitting is approximate—not studio-grade lip sync.</p></div><span class="tag">WHISPER + TTS + FFMPEG</span></div><div class="two-col"><div class="stack"><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">SOURCE VIDEO OR AUDIO</div><p class="subtle-copy" style="margin-top:5px">Imported media remains in the local app data folder.</p></div><span class="tag">LOCAL FILE</span></div>${asset ? fileChip(asset) : dropzone('dub-media', 'Drop a video or audio file', 'MP4, MOV, MKV, WAV, MP3…')}<div id="dubAssetPreview">${asset?.url && asset.kind === 'video' ? `<video controls class="preview-video" src="${asset.url}"></video>` : asset?.url ? `<audio controls class="audio-preview" src="${asset.url}"></audio>` : ''}</div></div><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">DUB SETTINGS</div><p class="subtle-copy" style="margin-top:5px">Choose language and a saved reference voice.</p></div></div><div class="form-grid"><div class="field"><label for="dubTarget">Output language</label>${languageSelect('dubTarget', 'en')}</div><div class="field"><label for="voiceSelect">Voice profile</label>${voiceSelect()}</div><div class="field full"><label for="dubMode">Translation</label><select class="select" id="dubMode"><option value="translate">Translate into output language</option><option value="same">Keep recognized words (same language)</option></select></div></div><div class="notice warning" style="margin-top:14px"><span class="notice-icon">ⓘ</span><span>${selected?.referencePath ? 'This profile has a local reference sample. XTTS and ffmpeg are required for voice-conditioned dubbing.' : 'Choose a consented reference profile and configure local XTTS + faster-whisper + ffmpeg. A descriptive profile alone is not a trained voice.'} The first version mixes a new speech track; source ambience / speaker separation is not performed.</span></div><button class="btn btn-primary btn-wide" style="margin-top:14px" data-action="dub" ${asset?.path ? '' : 'disabled'}>Start local dubbing job <span class="btn-icon">↗</span></button></div></div><div class="stack"><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">JOB OUTPUT</div><h3 style="margin-top:6px">Dubbed media</h3></div></div>${lastGeneratedPath ? outputPreview(lastGeneratedPath, 'Latest dubbed file') : emptyResult('Add media and start a local dubbing job. Long jobs appear in Projects & jobs.')}</div><div class="notice safe"><span class="notice-icon">⌑</span><span>Only use voice references you own or have explicit permission to reproduce. The result is synthetic speech; it cannot reproduce a person with 100% exactness.</span></div></div></div></div>`;
  }

  function renderAudiobook() {
    const translatedBlock = bookTextTranslated ? `<div id="bookTranslationBlock" style="margin-top:12px"><div class="panel-label">LOCAL TRANSLATION</div><div class="result-box" style="margin-top:8px;max-height:165px;overflow:auto">${esc(bookTextTranslated)}</div><label class="consent-row" style="margin-top:9px"><input type="checkbox" id="speakTranslatedBook" checked><span>Use translated text for narration.</span></label></div>` : '';
    return `<div class="page-enter"><div class="page-heading"><div><div class="eyebrow">DOCUMENT TO SPEECH</div><h1>Make an audiobook</h1><p class="lede">Import text, PDF or DOCX; optionally translate with local language packs, then save narration as WAV.</p></div><span class="tag">PIPER OR XTTS</span></div><div class="two-col"><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">BOOK TEXT</div><p class="subtle-copy" style="margin-top:5px">TXT, Markdown, selectable-text PDF and DOCX. Split chapters with blank lines.</p></div><button class="btn btn-small" data-pick="book-text">Import document</button></div>${activeAssets['book-document'] ? `<div style="margin-bottom:10px">${fileChip(activeAssets['book-document'])}</div>` : ''}<textarea class="textarea big" id="bookText" placeholder="Paste a chapter or import a plain-text document…">${esc(bookText)}</textarea><div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><span class="field-hint">${bookText.length.toLocaleString()} characters · stored in this window until you save a project</span><button class="btn btn-small btn-quiet" data-action="clear-book">Clear</button></div><hr class="form-divider"><div class="panel-label">TRANSLATE THIS DOCUMENT (OPTIONAL)</div><p class="subtle-copy" style="margin:6px 0 10px">Needs an installed offline Argos language pack. Scanned PDF pages need OCR before import.</p><div class="language-pair"><div class="field"><label for="bookSourceLanguage">From</label>${languageSelect('bookSourceLanguage', 'en')}</div><div class="language-swap">→</div><div class="field"><label for="bookLanguage">To / narration language</label>${languageSelect('bookLanguage', 'ur')}</div></div><button class="btn btn-wide" style="margin-top:10px" data-action="translate-book" ${bookText.trim() ? '' : 'disabled'}>Translate document locally <span class="btn-icon">✧</span></button>${translatedBlock}<div class="form-actions" style="margin-top:16px"><button class="btn btn-primary" data-action="audiobook" ${bookText.trim() ? '' : 'disabled'}>Generate audiobook <span class="btn-icon">↗</span></button><span class="field-hint">Audio is synthesized on this device.</span></div></div><div class="stack"><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">NARRATION SETTINGS</div><h3 style="margin-top:6px">Voice & delivery</h3></div></div><div class="field"><label for="voiceSelect">Voice profile</label>${voiceSelect()}</div><div class="field" style="margin-top:13px"><label for="bookEmotion">Delivery note</label><select class="select" id="bookEmotion"><option>Natural, steady pace</option><option>Warm and expressive</option><option>Calm and reflective</option><option>Bright and energetic</option></select></div><div class="notice warning" style="margin-top:14px"><span class="notice-icon">ⓘ</span><span>Long-form narration depends on local model quality and may need chapter-by-chapter review. Coqui/XTTS reference samples require permission. No model files are bundled.</span></div></div><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">LATEST AUDIO</div><h3 style="margin-top:6px">Preview & export</h3></div></div>${lastGeneratedPath ? outputPreview(lastGeneratedPath, 'Audiobook output') : emptyResult('Your generated audio will appear here.')}</div></div></div></div>`;
  }

  function renderPitch() {
    const asset = activeAssets['pitch-media'];
    const val = Number(document.getElementById('pitchRange')?.value ?? 0);
    return `<div class="page-enter"><div class="page-heading"><div><div class="eyebrow">PRECISE LOCAL AUDIO CONTROL</div><h1>Pitch & audio</h1><p class="lede">Shift the pitch of an audio file and export a WAV. Fine control spans −24 to +24 semitones in 0.01-step increments: 4,801 positions.</p></div><span class="tag">NO MODEL REQUIRED</span></div><div class="two-col equal-col"><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">SOURCE AUDIO</div><p class="subtle-copy" style="margin-top:5px">Pitch preview and processing run in this app.</p></div></div>${asset ? fileChip(asset) : dropzone('pitch-media', 'Drop an audio file here', 'WAV, MP3, M4A, FLAC, OGG…')}</div><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">FINE PITCH</div><p class="subtle-copy" style="margin-top:5px">Adjust in hundredths of a semitone.</p></div><span class="tag">4,801 STEPS</span></div><div class="pitch-display"><div><div class="pitch-value" id="pitchValue">${val >= 0 ? '+' : ''}${val.toFixed(2)}<span>st</span></div><div class="pitch-caption">${val === 0 ? 'Original pitch' : `${Math.pow(2, val / 12).toFixed(3)}× playback rate`}</div></div></div><div class="range-line"><span class="field-hint">−24</span><input type="range" id="pitchRange" min="-24" max="24" step="0.01" value="${val}"><span class="field-hint">+24</span></div><div class="range-scale"><span>Lower</span><span>Pitch shift · 0.01 semitone resolution</span><span>Higher</span></div><div class="preset-row"><button class="preset" data-pitch="-12">−12 · octave</button><button class="preset" data-pitch="-7">−7 · fifth</button><button class="preset" data-pitch="0">0 · original</button><button class="preset" data-pitch="5">+5 · fourth</button><button class="preset" data-pitch="12">+12 · octave</button></div><button class="btn btn-primary btn-wide" data-action="pitch-export" ${asset ? '' : 'disabled'}>Process & export WAV <span class="btn-icon">↗</span></button><p class="field-hint" style="margin-top:9px">Basic resampling shifts pitch and changes duration. Formant-preserving/time-stretch DSP is not included.</p></div></div><div class="notice warning" style="margin-top:15px"><span class="notice-icon">ⓘ</span><span>Pitch is not a way to create an exact identity match. This built-in tool is a lightweight local pitch shift, not a professional formant-aware voice converter.</span></div></div>`;
  }

  function renderSettings() {
    const tabs = [['models','Local engines'],['hardware','Hardware'],['appearance','Appearance'],['privacy','Privacy & data']];
    return `<div class="page-enter"><div class="page-heading"><div><div class="eyebrow">YOUR MACHINE, YOUR SETTINGS</div><h1>Settings & engines</h1><p class="lede">Connect local runtimes and model files. Nothing is downloaded by VoiceStudio; choose files you already have.</p></div><button class="btn btn-quiet" data-action="probe">↻ Check local setup</button></div><div class="settings-layout"><div class="card settings-tabs">${tabs.map(([id,label]) => `<button class="settings-tab ${settingsTab === id ? 'active' : ''}" data-settings-tab="${id}">${label}</button>`).join('')}</div><div class="card card-pad settings-panel">${settingsTab === 'models' ? renderModelSettings() : settingsTab === 'hardware' ? renderHardwareSettings() : settingsTab === 'appearance' ? renderAppearanceSettings() : renderPrivacySettings()}</div></div></div>`;
  }
  function renderModelSettings() {
    const probe = runtimeProbe;
    const status = (ready, note) => `<div class="engine-status-row"><div><strong>${esc(note[0])}</strong><span>${esc(note[1])}</span></div><span class="status-pill ${ready ? 'ready' : ''}">${ready ? 'DETECTED' : 'NOT READY'}</span></div>`;
    return `<div class="settings-section"><h3>Local runtime</h3><p>Use a system Python installation and optional local packages. VoiceStudio's bridge only works against local paths and forces model loading to stay offline.</p><div class="form-grid"><div class="field full"><label for="pythonPath">Python executable / command</label><div class="path-field"><input class="input" id="pythonPath" data-setting="pythonPath" value="${esc(state.settings.pythonPath || (navigator.platform.toLowerCase().includes('win') ? 'python' : 'python3'))}" placeholder="python3"><button class="btn btn-small" data-action="probe">Check</button></div><span class="field-hint">Example: python3, python, or an absolute path to the interpreter.</span></div></div><div style="margin-top:13px">${status(Boolean(probe?.python), ['Python bridge', probe?.python ? `${probe.python} · ${probe.platform || ''}` : lastProbeError || 'Not checked yet — choose a Python command and check setup.'])}${status(Boolean(probe?.packages?.faster_whisper && settingsReady('whisperModelPath')), ['Transcription · faster-whisper', probe?.packages?.faster_whisper ? (settingsReady('whisperModelPath') ? 'Package detected · model directory selected' : 'Package detected · select a local model directory') : 'Optional package is not installed'])}${status(Boolean(probe?.packages?.piper && settingsReady('piperModelPath')), ['Speech · Piper', probe?.packages?.piper ? (settingsReady('piperModelPath') ? 'Package detected · voice model selected' : 'Package detected · select a local .onnx voice') : 'Optional package is not installed'])}${status(Boolean(probe?.packages?.coqui_tts && settingsReady('xttsModelPath') && settingsReady('xttsConfigPath')), ['Reference speech · Coqui TTS / XTTS', probe?.packages?.coqui_tts ? (settingsReady('xttsModelPath') && settingsReady('xttsConfigPath') ? 'Package detected · local model and config selected' : 'Package detected · select local checkpoint folder and config') : 'Optional package is not installed'])}</div></div>
      <div class="settings-section"><h3>Speech recognition</h3><p>Point to a downloaded local faster-whisper model folder. The bridge uses <code>local_files_only</code>; it will not fetch a missing model.</p><div class="field"><label>Whisper model directory</label><div class="path-field"><input class="input" readonly value="${esc(state.settings.whisperModelPath || 'No model folder selected')}"><button class="btn btn-small" data-choose-path="whisperModelPath" data-kind="directory">Choose folder</button></div></div></div>
      <div class="settings-section"><h3>Speech synthesis</h3><p>Configure Piper for a local voice, or Coqui/XTTS plus a consented reference sample for voice-conditioned synthesis.</p><div class="form-grid"><div class="field"><label>Piper executable (optional)</label><div class="path-field"><input class="input" readonly value="${esc(state.settings.piperPath || 'Not set')}"><button class="btn btn-small" data-choose-path="piperPath" data-kind="file">Browse</button></div></div><div class="field"><label>Piper voice model (.onnx)</label><div class="path-field"><input class="input" readonly value="${esc(state.settings.piperModelPath || 'Not set')}"><button class="btn btn-small" data-choose-path="piperModelPath" data-kind="model">Browse</button></div></div><div class="field"><label>XTTS model directory</label><div class="path-field"><input class="input" readonly value="${esc(state.settings.xttsModelPath || 'Not set')}"><button class="btn btn-small" data-choose-path="xttsModelPath" data-kind="directory">Choose folder</button></div></div><div class="field"><label>XTTS config.json</label><div class="path-field"><input class="input" readonly value="${esc(state.settings.xttsConfigPath || 'Not set')}"><button class="btn btn-small" data-choose-path="xttsConfigPath" data-kind="file">Browse</button></div></div></div></div>
      <div class="settings-section"><h3>Media tools</h3><p>ffmpeg is used to write dubbed media and merge long-form audio. A system executable may be used if this field is empty.</p><div class="path-field"><input class="input" readonly value="${esc(state.settings.ffmpegPath || 'Use ffmpeg from PATH, if installed')}"><button class="btn btn-small" data-choose-path="ffmpegPath" data-kind="file">Choose ffmpeg</button></div></div>
      <div class="notice warning"><span class="notice-icon">ⓘ</span><span>Model and package licenses vary. Check each project's terms before use or redistribution. The UI and local bridge do not bundle voice weights.</span></div>`;
  }
  function renderHardwareSettings() {
    return `<div class="settings-section"><h3>Hardware target</h3><p>Choose a target for local inference. Not every package supports every accelerator; CPU is the safest fallback.</p><div class="field"><label for="deviceSetting">Compute device</label><select class="select" id="deviceSetting" data-setting="device"><option value="auto" ${state.settings.device === 'auto' ? 'selected' : ''}>Auto detect</option><option value="cpu" ${state.settings.device === 'cpu' ? 'selected' : ''}>CPU · compatible fallback</option><option value="cuda" ${state.settings.device === 'cuda' ? 'selected' : ''}>NVIDIA CUDA</option><option value="mps" ${state.settings.device === 'mps' ? 'selected' : ''}>Apple Metal / MPS (current bridge falls back to CPU)</option></select></div><div class="notice" style="margin-top:14px"><span class="notice-icon">⌘</span><span>Fast inference depends on your machine, model size, drivers and precision. VoiceStudio does not upload telemetry or hardware details. If an accelerator fails, select CPU and retry.</span></div></div><div class="settings-section"><h3>Supported workflow</h3><p>The bridge maps the MPS preference to CPU for faster-whisper and XTTS currently uses CPU or CUDA. Piper runs on CPU. Apple Metal acceleration is not wired into this starter bridge yet; select CPU for predictable behavior.</p><div class="engine-status-row"><div><strong>Current device preference</strong><span>${esc(state.settings.device || 'auto')}</span></div><span class="status-pill">LOCAL</span></div></div>`;
  }
  function renderAppearanceSettings() {
    return `<div class="settings-section"><h3>Theme</h3><p>Choose a comfortable workspace theme. Your preference stays in the local app settings.</p><div class="form-grid equal-col"><button class="card card-pad" data-theme-choice="dark" style="text-align:left;cursor:pointer;border-color:${state.theme === 'dark' ? 'var(--accent)' : 'var(--line)'}"><div class="kicker">DARK STUDIO</div><div style="margin-top:12px;padding:13px;border-radius:8px;background:#10121b;border:1px solid rgba(255,255,255,.08)"><div style="height:5px;width:40%;background:#a18cff;border-radius:3px"></div><div style="height:5px;width:75%;background:#303342;border-radius:3px;margin-top:8px"></div></div><div class="field-hint" style="margin-top:9px">Deep charcoal · violet accent</div></button><button class="card card-pad" data-theme-choice="light" style="text-align:left;cursor:pointer;border-color:${state.theme === 'light' ? 'var(--accent)' : 'var(--line)'}"><div class="kicker">LIGHT STUDIO</div><div style="margin-top:12px;padding:13px;border-radius:8px;background:#faf9ff;border:1px solid #e8e6ef"><div style="height:5px;width:40%;background:#7559e9;border-radius:3px"></div><div style="height:5px;width:75%;background:#e4e2ec;border-radius:3px;margin-top:8px"></div></div><div class="field-hint" style="margin-top:9px">Soft paper · violet accent</div></button></div></div><div class="settings-section"><h3>Motion</h3><p>VoiceStudio uses small interface transitions and an animated audio motif. System reduced-motion preferences are respected.</p></div>`;
  }
  function renderPrivacySettings() {
    return `<div class="settings-section"><h3>Local data folder</h3><p>Imported media, outputs, and app state are stored in your operating system's VoiceStudio user-data directory.</p><div class="notice safe"><span class="notice-icon">⌑</span><span><strong>App networking is disabled by design.</strong> The renderer has a strict Content Security Policy with network connections blocked. Engine execution is local Python only; model download is never automatic.</span></div><div class="form-actions" style="margin-top:13px"><button class="btn" data-action="open-data">Open VoiceStudio data folder</button><button class="btn btn-quiet" data-action="show-app-info">Show app info</button></div><div id="appInfoBlock" class="field-hint" style="margin-top:10px"></div></div><div class="settings-section"><h3>Privacy controls</h3><div class="toggle-row"><div class="toggle-copy"><strong>Cloud and telemetry</strong><span>Always off. There is no account, API-key field, analytics SDK or remote inference route.</span></div><span class="status-pill ready">OFF</span></div><div class="toggle-row"><div class="toggle-copy"><strong>Keep local imports</strong><span>Remove imported files, voice reference samples and outputs by deleting the VoiceStudio data folder.</span></div><span class="status-pill">YOU CONTROL IT</span></div></div><div class="settings-section"><h3>Consent and limitations</h3><p>Only use voice references you own or have explicit permission to use. Similarity varies by model and recording. Exact, 100% voice identity reproduction cannot be guaranteed; do not use synthetic speech to deceive, impersonate, defraud, or imply a real person's endorsement.</p><p>Voice profiles and reference recordings are stored locally. This app does not cryptographically verify consent; the consent checkbox is an intentional-use reminder.</p></div>`;
  }

  function recentJobsMarkup(jobs) {
    return `<div class="jobs-list">${jobs.map(job => `<div class="job-row"><div class="job-type-icon">${job.status === 'done' ? '✓' : job.status === 'running' ? '◌' : '↗'}</div><div class="job-row-main"><strong>${esc(job.name)}</strong><span>${esc(relativeTime(job.createdAt))}${job.error ? ` · ${esc(job.error)}` : ''}</span><div class="job-progress"><i style="--progress:${Math.max(0, Math.min(100, job.progress || 0))}%"></i></div></div><span class="job-status ${esc(job.status)}">${esc(job.status)}</span></div>`).join('')}</div>`;
  }
  function renderProjects() {
    const jobs = state.jobs;
    const files = state.recentFiles;
    return `<div class="page-enter"><div class="page-heading"><div><div class="eyebrow">LOCAL WORKSPACE</div><h1>Projects & jobs</h1><p class="lede">See ongoing tasks, outputs and recently imported files. Job history stays on this machine.</p></div><button class="btn btn-quiet" data-action="clear-jobs">Clear history</button></div><div class="two-col equal-col"><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">JOB HISTORY</div><h3 style="margin-top:6px">Processing queue</h3></div><span class="tag">${jobs.length} TOTAL</span></div>${jobs.length ? recentJobsMarkup(jobs) : `<div class="empty-state"><div class="empty-orbit">↗</div><h3>No jobs yet</h3><p>When you transcribe, generate or dub, local progress will appear here.</p></div>`}${jobs.some(j => j.outputPath) ? `<hr class="form-divider"><div class="jobs-list">${jobs.filter(j => j.outputPath).map(j => `<div class="file-chip"><div class="file-chip-icon">${/\.(wav|mp3|m4a|ogg|flac|mp4|mkv|mov)$/i.test(j.outputPath) ? '♫' : '▤'}</div><div class="file-chip-info"><strong>${esc(j.outputName || j.outputPath.split(/[\\/]/).pop())}</strong><span>${esc(j.name)} · local output</span></div><button class="btn btn-small" data-save-copy="${esc(j.outputPath)}" data-name="${esc(j.outputName || 'VoiceStudio-output.wav')}">Export</button>${/\.(wav|mp3|m4a|ogg|flac|mp4|mkv|mov)$/i.test(j.outputPath) ? `<button class="btn btn-small btn-quiet" data-play-path="${esc(j.outputPath)}">▶</button>` : ''}</div>`).join('')}</div>` : ''}</div><div class="card card-pad"><div class="card-title-row"><div><div class="panel-label">RECENT IMPORTS</div><h3 style="margin-top:6px">Files in this workspace</h3></div><button class="btn btn-small btn-quiet" data-action="open-data">Open folder</button></div>${files.length ? `<div class="jobs-list">${files.slice(0,12).map(f => `<div class="file-chip"><div class="file-chip-icon">▤</div><div class="file-chip-info"><strong>${esc(f.name)}</strong><span>${esc(f.kind || 'media')} · ${humanBytes(f.size || 0)} · ${esc(relativeTime(f.createdAt))}</span></div></div>`).join('')}</div>` : `<div class="empty-state"><div class="empty-orbit">↥</div><h3>No recent imports</h3><p>Imported files are copied to your local VoiceStudio workspace to make them available to the processing engine.</p></div>`}</div></div></div>`;
  }

  function outputPreview(path, label) {
    const isAudio = /\.(wav|mp3|m4a|ogg|flac|opus)$/i.test(path);
    return `<div class="file-chip"><div class="file-chip-icon">${isAudio ? '♫' : '▤'}</div><div class="file-chip-info"><strong>${esc(label)}</strong><span>Saved inside VoiceStudio · local only</span></div><button class="btn btn-small" data-save-copy="${esc(path)}" data-name="${esc(path.split(/[\\/]/).pop())}">Export</button></div>${isAudio ? `<audio controls class="audio-preview" data-audio-path="${esc(path)}"></audio>` : ''}`;
  }

  function render() {
    updateChrome();
    const pageRenderers = {
      launchpad: renderLaunchpad, 'voice-lab': renderVoiceLab, gallery: renderGallery,
      dictation: renderDictation, transcribe: renderTranscribe, dubbing: renderDubbing,
      audiobook: renderAudiobook, pitch: renderPitch, settings: renderSettings, projects: renderProjects
    };
    content.innerHTML = (pageRenderers[page] || renderLaunchpad)();
    if (page === 'gallery') {
      const search = document.getElementById('voiceSearch');
      if (search) search.addEventListener('input', () => {
        const cursor = search.selectionStart;
        render();
        const again = document.getElementById('voiceSearch');
        if (again) { again.focus(); again.setSelectionRange(cursor, cursor); }
      });
    }
    bindOutputAudio();
  }

  async function bindOutputAudio() {
    if (!api) return;
    for (const el of content.querySelectorAll('audio[data-audio-path]')) {
      const filePath = el.dataset.audioPath;
      try {
        const base64 = await api.readLocalAsset(filePath);
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const ext = filePath.split('.').pop().toLowerCase();
        const type = ext === 'mp3' ? 'audio/mpeg' : ext === 'ogg' ? 'audio/ogg' : 'audio/wav';
        el.src = URL.createObjectURL(new Blob([bytes], { type }));
      } catch (error) { console.warn('Could not preview local output:', error.message); }
    }
  }

  function openPicker(purpose) {
    filePicker.dataset.purpose = purpose;
    filePicker.accept = PICK_ACCEPT[purpose] || '*/*';
    filePicker.multiple = false;
    filePicker.click();
  }
  async function importFile(file, purpose) {
    if (!file) return;
    if (purpose === 'book-text') {
      const extension = file.name.split('.').pop().toLowerCase();
      if (['txt', 'md', 'text'].includes(extension) || file.type.startsWith('text/')) {
        try { bookText = await file.text(); bookTextTranslated = ''; delete activeAssets['book-document']; render(); toast(`Loaded ${file.name}`); }
        catch (_) { toast('Could not read this text file.', 'error'); }
        return;
      }
      if (!['pdf', 'docx'].includes(extension)) { toast('Supported document files: TXT, Markdown, selectable-text PDF and DOCX.', 'error'); return; }
      if (!api) { toast('PDF and DOCX extraction requires the desktop app and optional local Python parser packages.', 'info'); return; }
      try {
        const saved = await api.importAsset(file.name, new Uint8Array(await file.arrayBuffer()));
        const asset = { path: saved.path, name: file.name, size: saved.size, type: file.type, kind: 'document', purpose: 'book-document', url: '' };
        activeAssets['book-document'] = asset;
        state.recentFiles.unshift({ name: file.name, path: saved.path, size: file.size, kind: 'document', createdAt: new Date().toISOString() });
        state.recentFiles = state.recentFiles.slice(0, 30);
        persist(); render();
        runJob(`Extract text from ${file.name}`, 'extract_document', { input_path: saved.path }, result => {
          bookText = result.text || ''; bookTextTranslated = '';
          toast(`Extracted ${bookText.length.toLocaleString()} characters locally.`);
        });
      } catch (error) { toast(`Could not import document: ${error.message}`, 'error'); }
      return;
    }
    const previous = activeAssets[purpose];
    if (previous?.url) URL.revokeObjectURL(previous.url);
    const url = URL.createObjectURL(file);
    let stored = { path: '', name: file.name, size: file.size, type: file.type, kind: file.type.startsWith('video/') ? 'video' : 'audio', url, purpose, file };
    if (api) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const saved = await api.importAsset(file.name, bytes);
        stored = { ...stored, path: saved.path, name: file.name, size: saved.size };
      } catch (error) {
        toast(`Could not save this file locally: ${error.message}`, 'error');
        return;
      }
    }
    activeAssets[purpose] = stored;
    if (purpose === 'voice-sample') voiceDraft.samplePath = stored.path;
    if (purpose === 'transcribe-media' || purpose === 'dictation-audio') transcriptState = { text: '', translated: '', language: '', segments: [] };
    state.recentFiles.unshift({ name: file.name, path: stored.path, size: file.size, kind: stored.kind, createdAt: new Date().toISOString() });
    state.recentFiles = state.recentFiles.slice(0, 30);
    persist();
    render();
    toast(`${file.name} added to the local workspace.`);
  }

  async function startRecording(target) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast('Microphone recording is not available in this environment. Use Import sample instead.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) options.mimeType = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) options.mimeType = 'audio/ogg;codecs=opus';
      const recorder = new MediaRecorder(stream, options);
      const chunks = [];
      recording = { target, recorder, stream, chunks, startedAt: Date.now() };
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const mime = recorder.mimeType || 'audio/webm';
        const extension = mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
        const blob = new Blob(chunks, { type: mime });
        recording = null;
        if (blob.size) {
          const file = new File([blob], `voicestudio-recording-${Date.now()}.${extension}`, { type: mime });
          await importFile(file, target);
        } else {
          render();
          toast('No audio was captured. Try again or import a file.', 'error');
        }
      };
      recorder.start(250);
      render();
      toast('Recording started. Audio is captured locally.', 'info');
    } catch (error) {
      recording = null;
      toast(`Microphone permission was not granted: ${error.message}`, 'error');
      render();
    }
  }
  function stopRecording() {
    if (!recording) return;
    try { recording.recorder.stop(); }
    catch (_) { recording.stream.getTracks().forEach(track => track.stop()); recording = null; render(); }
  }

  function saveVoice() {
    const name = voiceDraft.name.trim() || `Voice profile ${state.voices.length + 1}`;
    if (!voiceDraft.consent) {
      toast('Please confirm you have permission to use this voice.', 'error');
      return;
    }
    const sample = activeAssets['voice-sample'];
    if (voiceMode === 'clone' && !sample?.path) {
      toast(api ? 'Record or import a local reference sample before saving a clone profile.' : 'In the desktop app, import a sample to attach a local reference file.', 'error');
      return;
    }
    const voice = {
      id: `voice-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      name, mode: voiceMode, age: voiceDraft.age, style: voiceDraft.style,
      accent: voiceDraft.accent.trim(), emotion: voiceDraft.emotion,
      description: voiceDraft.description.trim(), referencePath: voiceMode === 'clone' ? sample.path : '',
      sampleName: voiceMode === 'clone' ? sample.name : '', createdAt: new Date().toISOString()
    };
    state.voices.unshift(voice);
    state.selectedVoiceId = voice.id;
    voiceDraft = { name: '', age: '26-35', style: 'Feminine', accent: '', emotion: 'Warm', description: '', consent: false };
    voiceMode = 'clone';
    persist();
    render();
    toast('Voice profile saved locally. Model training is not implied.');
  }

  function pickVoice(id) {
    const voice = state.voices.find(v => v.id === id);
    if (!voice) return null;
    state.selectedVoiceId = id;
    persist();
    return voice;
  }
  function voiceRequest(id) {
    const voice = state.voices.find(v => v.id === id) || state.voices.find(v => v.id === state.selectedVoiceId) || null;
    return voice ? { ...voice, reference_path: voice.referencePath || '' } : null;
  }

  async function runJob(name, action, payload, onSuccess) {
    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      name, action, status: 'running', progress: 2, createdAt: new Date().toISOString(),
      outputPath: '', outputName: '', error: ''
    };
    state.jobs.unshift(job);
    state.jobs = state.jobs.slice(0, 40);
    persist();
    render();
    if (!api) {
      job.status = 'failed'; job.progress = 0; job.error = 'Open the Electron desktop build to run local models.';
      persist(); render(); toast('The browser preview is UI-only. Run VoiceStudio desktop for local model jobs.', 'error');
      return;
    }
    try {
      const result = await api.runLocalJob({ ...payload, action, jobId: job.id, settings: state.settings });
      if (!result?.ok) throw new Error(result?.error || 'The local engine could not complete this job.');
      job.status = 'done'; job.progress = 100;
      if (result.output_path) {
        job.outputPath = result.output_path;
        job.outputName = result.output_name || result.output_path.split(/[\\/]/).pop();
        lastGeneratedPath = result.output_path;
      }
      if (typeof onSuccess === 'function') onSuccess(result);
      persist(); render();
      toast(result.message || `${name} complete.`);
    } catch (error) {
      job.status = 'failed'; job.progress = 0; job.error = error.message || 'Local job failed.';
      persist(); render(); toast(job.error, 'error');
    }
  }
  if (api?.onProgress) {
    api.onProgress(payload => {
      const job = state.jobs.find(item => item.id === payload.jobId);
      if (job) {
        job.progress = Math.max(2, Math.min(99, Number(payload.progress) || job.progress));
        if (payload.message) job.currentStep = payload.message;
        const row = [...document.querySelectorAll('.job-row')].find(el => el.textContent.includes(job.name));
        const bar = row?.querySelector('.job-progress i');
        if (bar) bar.style.setProperty('--progress', `${job.progress}%`);
      }
    });
  }

  function requirePath(asset, label) {
    if (!asset?.path) {
      toast(api ? `Import ${label} in the desktop app first.` : 'Open the VoiceStudio desktop build to run local processing.', 'error');
      return false;
    }
    return true;
  }
  function transcribeAsset(asset, title = 'Transcribe audio', callback) {
    if (!requirePath(asset, 'audio or video')) return;
    runJob(title, 'transcribe', { input_path: asset.path }, result => {
      transcriptState = { text: result.text || '', translated: '', language: result.language || '', segments: result.segments || [] };
      if (callback) callback(result);
    });
  }
  function translateTranscript() {
    if (!transcriptState.text) { toast('Transcribe media before translating.', 'error'); return; }
    const from = document.getElementById('translateFrom')?.value || transcriptState.language || 'auto';
    const to = document.getElementById('translateTo')?.value || 'en';
    runJob(`Translate ${from} → ${to}`, 'translate', { text: transcriptState.text, from_language: from, to_language: to, segments: transcriptState.segments }, result => {
      transcriptState.translated = result.text || '';
    });
  }
  function currentVoiceFrom(id) {
    const select = document.getElementById(id);
    if (select?.value) return voiceRequest(select.value);
    return voiceRequest(state.selectedVoiceId);
  }
  function voicePreview() {
    const text = document.getElementById('speechText')?.value.trim() || '';
    if (!text) { toast('Add a short line of text to speak.', 'error'); return; }
    const voice = currentVoiceFrom('voiceSelect');
    if (!voice && !state.settings.piperModelPath) {
      toast('Choose a saved voice profile and configure a local Piper or XTTS model.', 'error'); return;
    }
    if (voice?.mode === 'design' && !voice.reference_path) {
      toast('This is a descriptive profile only, not a trained voice. Piper will use its selected voice; description-conditioned synthesis is not implemented here.', 'info');
    }
    runJob('Generate speech sample', 'tts', { text, language: 'en', voice }, result => {
      lastGeneratedPath = result.output_path || '';
    });
  }
  function startDubbing() {
    const asset = activeAssets['dub-media'];
    if (!requirePath(asset, 'source video or audio')) return;
    const voice = currentVoiceFrom('voiceSelect');
    if (!voice) { toast('Save and select a voice profile first.', 'error'); return; }
    if (!voice.reference_path) { toast('Dubbing with voice likeness needs a consented reference sample and a local XTTS model.', 'error'); return; }
    const target = document.getElementById('dubTarget')?.value || 'en';
    const mode = document.getElementById('dubMode')?.value || 'translate';
    runJob(`Dub ${asset.name}`, 'dub', {
      input_path: asset.path, target_language: target, translate: mode === 'translate', voice,
      output_name: `${asset.name.replace(/\.[^.]+$/, '')}-${target}-dubbed.mp4`
    }, result => { lastGeneratedPath = result.output_path || ''; });
  }
  function translateBook() {
    const text = document.getElementById('bookText')?.value.trim() || bookText.trim();
    if (!text) { toast('Add or import a document before translating.', 'error'); return; }
    const from = document.getElementById('bookSourceLanguage')?.value || 'en';
    const to = document.getElementById('bookLanguage')?.value || 'ur';
    runJob(`Translate document ${from} → ${to}`, 'translate', { text, from_language: from, to_language: to }, result => {
      bookTextTranslated = result.text || '';
    });
  }
  function makeAudiobook() {
    const sourceText = document.getElementById('bookText')?.value.trim() || bookText.trim();
    const useTranslated = Boolean(document.getElementById('speakTranslatedBook')?.checked && bookTextTranslated);
    const text = useTranslated ? bookTextTranslated : sourceText;
    if (!text) { toast('Add or import a passage first.', 'error'); return; }
    const voice = currentVoiceFrom('voiceSelect');
    const language = useTranslated ? (document.getElementById('bookLanguage')?.value || 'en') : (document.getElementById('bookSourceLanguage')?.value || 'en');
    runJob('Create audiobook', 'audiobook', { text, language, voice, output_name: 'voicestudio-audiobook.wav' }, result => {
      lastGeneratedPath = result.output_path || '';
    });
  }
  function speakTranslation() {
    if (!transcriptState.translated) return;
    const voice = voiceRequest(state.selectedVoiceId);
    runJob('Speak translated transcript', 'tts', { text: transcriptState.translated, language: document.getElementById('translateTo')?.value || 'en', voice }, result => {
      lastGeneratedPath = result.output_path || '';
    });
  }

  async function playLocalPath(filePath) {
    if (!filePath) return;
    if (activeAssets && Object.values(activeAssets).some(asset => asset.path === filePath && asset.url)) {
      const asset = Object.values(activeAssets).find(item => item.path === filePath);
      try { const audio = new Audio(asset.url); await audio.play(); return; } catch (_) { /* use app data reader */ }
    }
    if (!api) { toast('Preview the file in the desktop app to read it from the local workspace.', 'info'); return; }
    try {
      const base64 = await api.readLocalAsset(filePath);
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const ext = filePath.split('.').pop().toLowerCase();
      const type = ext === 'mp3' ? 'audio/mpeg' : ext === 'ogg' ? 'audio/ogg' : ext === 'mp4' ? 'video/mp4' : 'audio/wav';
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      if (currentAudio) { try { currentAudio.pause(); URL.revokeObjectURL(currentAudio.src); } catch (_) {} }
      currentAudio = new Audio(url);
      await currentAudio.play();
      currentAudio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
    } catch (error) { toast(`Could not open local preview: ${error.message}`, 'error'); }
  }
  async function exportCopy(sourcePath, name) {
    if (!api) { toast('Export from the desktop build to copy a file from the local workspace.', 'info'); return; }
    try {
      const saved = await api.saveCopy({ sourcePath, suggestedName: name });
      if (saved) toast(`Exported to ${saved}`);
    } catch (error) { toast(error.message, 'error'); }
  }
  async function exportBytes(name, bytes) {
    if (api) {
      const path = await api.saveBytes({ name, bytes: new Uint8Array(bytes) });
      if (path) toast(`Saved ${path}`);
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      toast('Downloaded a locally processed WAV.');
    }
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard.'); }
    catch (_) {
      const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select();
      try { document.execCommand('copy'); toast('Copied to clipboard.'); } catch (_) { toast('Clipboard access was not available.', 'error'); }
      area.remove();
    }
  }
  async function exportText(name, text) {
    const bytes = new TextEncoder().encode(text);
    if (api) {
      const path = await api.saveBytes({ name, bytes });
      if (path) toast(`Saved ${path}`);
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function getAssetBuffer(asset) {
    if (asset?.file) return new Float32Array(await decodeAudioData(await asset.file.arrayBuffer()));
    if (asset?.path && api) {
      const b64 = await api.readLocalAsset(asset.path);
      const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return decodeAudioData(raw.buffer);
    }
    throw new Error('The source audio is no longer available. Import it again.');
  }
  async function decodeAudioData(arrayBuffer) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('Audio processing is not supported by this browser engine.');
    const context = new AudioCtx();
    try { return await context.decodeAudioData(arrayBuffer.slice(0)); }
    finally { await context.close(); }
  }
  async function processPitch() {
    const asset = activeAssets['pitch-media'];
    if (!asset) { toast('Import an audio file first.', 'error'); return; }
    const semitones = Number(document.getElementById('pitchRange')?.value || 0);
    try {
      toast('Processing audio locally…', 'info');
      const input = await getAssetBuffer(asset);
      const ratio = Math.pow(2, semitones / 12);
      const frames = Math.max(1, Math.ceil(input.length / ratio));
      const estimatedBytes = frames * input.numberOfChannels * 4;
      if (estimatedBytes > 256 * 1024 * 1024) throw new Error('This pitch setting would use over 256 MB of output audio memory. Try a shorter clip or a smaller pitch shift.');
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline) throw new Error('Offline audio processing is unavailable in this runtime.');
      const ctx = new Offline(input.numberOfChannels, frames, input.sampleRate);
      const source = ctx.createBufferSource(); source.buffer = input; source.playbackRate.value = ratio; source.connect(ctx.destination); source.start(0);
      const output = await ctx.startRendering();
      await exportBytes(`${asset.name.replace(/\.[^.]+$/, '')}-${semitones.toFixed(2)}st.wav`, encodeWav(output));
    } catch (error) { toast(`Pitch processing failed: ${error.message}`, 'error'); }
  }
  function encodeWav(buffer) {
    const channels = buffer.numberOfChannels;
    const length = buffer.length;
    const bytesPerSample = 2;
    const dataBytes = length * channels * bytesPerSample;
    const array = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(array);
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true); view.setUint16(34, bytesPerSample * 8, true);
    writeStr(36, 'data'); view.setUint32(40, dataBytes, true);
    let offset = 44;
    for (let i = 0; i < length; i++) for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2;
    }
    return array;
  }

  async function refreshProbe() {
    if (!api) { runtimeProbe = null; lastProbeError = 'Available in the Electron desktop app.'; updateChrome(); return; }
    const button = document.querySelector('[data-action="probe"]');
    if (button) { button.disabled = true; button.textContent = 'Checking…'; }
    try {
      const result = await api.probeRuntime(state.settings);
      runtimeProbe = result;
      lastProbeError = result?.ok ? '' : (result?.error || 'Python runtime not found.');
      if (!result?.ok) toast(lastProbeError, 'error');
      else toast('Local Python runtime checked. No network request was made.');
    } catch (error) { lastProbeError = error.message; toast(lastProbeError, 'error'); }
    if (button) { button.disabled = false; button.textContent = '↻ Check local setup'; }
    updateChrome();
    if (page === 'settings') render();
  }

  // File picker and drop zones
  filePicker.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    const purpose = filePicker.dataset.purpose;
    if (file) await importFile(file, purpose);
    filePicker.value = '';
  });
  document.addEventListener('dragover', event => {
    const zone = event.target.closest?.('[data-drop]');
    if (zone) { event.preventDefault(); zone.classList.add('drag-over'); }
  });
  document.addEventListener('dragleave', event => {
    const zone = event.target.closest?.('[data-drop]');
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('drag-over');
  });
  document.addEventListener('drop', async event => {
    const zone = event.target.closest?.('[data-drop]');
    if (!zone) return;
    event.preventDefault(); zone.classList.remove('drag-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) await importFile(file, zone.dataset.drop);
  });

  document.addEventListener('input', event => {
    const target = event.target;
    if (target.matches('[data-draft]')) voiceDraft[target.dataset.draft] = target.value;
    if (target.id === 'speechText') speechDraft = target.value;
    if (target.id === 'bookText') {
      bookText = target.value;
      bookTextTranslated = '';
      const hasText = Boolean(bookText.trim());
      const translateButton = document.querySelector('[data-action="translate-book"]');
      const audiobookButton = document.querySelector('[data-action="audiobook"]');
      if (translateButton) translateButton.disabled = !hasText;
      if (audiobookButton) audiobookButton.disabled = !hasText;
      document.getElementById('bookTranslationBlock')?.remove();
    }
    if (target.id === 'pitchRange') {
      const value = Number(target.value);
      const display = document.getElementById('pitchValue');
      if (display) display.innerHTML = `${value >= 0 ? '+' : ''}${value.toFixed(2)}<span>st</span>`;
      const caption = display?.parentElement?.querySelector('.pitch-caption');
      if (caption) caption.textContent = value === 0 ? 'Original pitch' : `${Math.pow(2, value / 12).toFixed(3)}× playback rate`;
    }
    if (target.matches('[data-setting]')) state.settings[target.dataset.setting] = target.value;
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (target.id === 'voiceConsent') voiceDraft.consent = target.checked;
    if (target.matches('[data-setting]')) {
      state.settings[target.dataset.setting] = target.value;
      persist();
      updateChrome();
    }
    if (target.id === 'voiceSelect' || target.id === 'bookVoice') {
      if (target.value) pickVoice(target.value);
    }
  });

  document.addEventListener('click', async event => {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) {
      event.preventDefault();
      page = pageButton.dataset.page;
      if (page === 'gallery') render(); else render();
      return;
    }
    const pick = event.target.closest('[data-pick]');
    if (pick) { event.preventDefault(); openPicker(pick.dataset.pick); return; }
    const zone = event.target.closest('[data-drop]');
    if (zone && !event.target.closest('button')) { openPicker(zone.dataset.drop); return; }
    const recordButton = event.target.closest('[data-record]');
    if (recordButton) {
      event.preventDefault();
      const target = recordButton.dataset.record;
      if (recording?.target === target) stopRecording();
      else if (recording) toast('Stop the current recording before starting another.', 'info');
      else startRecording(target);
      return;
    }
    const modeButton = event.target.closest('[data-voice-mode]');
    if (modeButton) { voiceMode = modeButton.dataset.voiceMode; render(); return; }
    const settingsButton = event.target.closest('[data-settings-tab]');
    if (settingsButton) { settingsTab = settingsButton.dataset.settingsTab; render(); return; }
    const themeChoice = event.target.closest('[data-theme-choice]');
    if (themeChoice) { setTheme(themeChoice.dataset.themeChoice); render(); return; }
    const pitchPreset = event.target.closest('[data-pitch]');
    if (pitchPreset) {
      const range = document.getElementById('pitchRange');
      if (range) { range.value = pitchPreset.dataset.pitch; range.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    const choose = event.target.closest('[data-choose-path]');
    if (choose) {
      if (!api) { toast('Path selection is available in the desktop build.', 'info'); return; }
      try {
        const path = await api.choosePath({ kind: choose.dataset.kind, title: `Choose ${choose.dataset.choosePath}` });
        if (path) { state.settings[choose.dataset.choosePath] = path; persist(); render(); }
      } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const play = event.target.closest('[data-play-path]');
    if (play) { playLocalPath(play.dataset.playPath); return; }
    const removeAsset = event.target.closest('[data-remove-asset]');
    if (removeAsset) {
      const purpose = removeAsset.dataset.removeAsset;
      const target = purpose || Object.keys(activeAssets).find(key => activeAssets[key]?.path === removeAsset.closest('.file-chip')?.dataset.path);
      if (target && activeAssets[target]?.url) URL.revokeObjectURL(activeAssets[target].url);
      if (target) delete activeAssets[target];
      render(); return;
    }
    const exportButton = event.target.closest('[data-save-copy]');
    if (exportButton) { exportCopy(exportButton.dataset.saveCopy, exportButton.dataset.name); return; }
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    switch (action) {
      case 'save-voice': saveVoice(); break;
      case 'voice-preview': speechDraft = document.getElementById('speechText')?.value || ''; voicePreview(); break;
      case 'dictate': transcribeAsset(activeAssets['dictation-audio'], 'Dictation transcription'); break;
      case 'transcribe': transcribeAsset(activeAssets['transcribe-media'], 'Transcribe media'); break;
      case 'translate': translateTranscript(); break;
      case 'dub': startDubbing(); break;
      case 'audiobook': bookText = document.getElementById('bookText')?.value || bookText; makeAudiobook(); break;
      case 'translate-book': bookText = document.getElementById('bookText')?.value || bookText; translateBook(); break;
      case 'pitch-export': processPitch(); break;
      case 'speak-translation': speakTranslation(); break;
      case 'copy-transcript': copyText(transcriptState.text); break;
      case 'copy-translation': copyText(transcriptState.translated); break;
      case 'export-transcript': exportText('transcript.txt', transcriptState.text); break;
      case 'clear-book': bookText = ''; bookTextTranslated = ''; delete activeAssets['book-document']; render(); break;
      case 'probe': refreshProbe(); break;
      case 'open-data':
        if (api) api.openDataFolder().then(() => toast('Opened VoiceStudio data folder.')).catch(error => toast(error.message, 'error'));
        else toast('Open the desktop app to browse its local data folder.', 'info');
        break;
      case 'open-widget':
        if (api) api.openWidget().then(registered => toast(registered ? 'Mini dictation widget opened. Hotkey: Ctrl/⌘ + Shift + Space.' : 'Widget opened, but the system hotkey is unavailable. Use the top-bar button.', registered ? 'success' : 'info')).catch(error => toast(error.message, 'error'));
        else toast('Open the Electron desktop build to use the floating widget.', 'info');
        break;
      case 'show-app-info':
        if (api) api.getAppInfo().then(info => {
          const block = document.getElementById('appInfoBlock');
          if (block) block.textContent = `${info.platform} · ${info.architecture} · data: ${info.dataDirectory}`;
        });
        break;
      case 'clear-jobs': state.jobs = []; persist(); render(); toast('Local job history cleared.'); break;
      case 'delete-voice': {
        const id = actionButton.dataset.id;
        state.voices = state.voices.filter(voice => voice.id !== id);
        if (state.selectedVoiceId === id) state.selectedVoiceId = state.voices[0]?.id || '';
        persist(); render(); toast('Voice profile removed from the local library. The reference file remains in Imports until you delete it.');
        break;
      }
      case 'use-voice': {
        const voice = pickVoice(actionButton.dataset.id);
        if (voice) { page = 'audiobook'; render(); toast(`${voice.name} selected for narration.`); }
        break;
      }
      default: break;
    }
  });

  document.getElementById('themeToggle').addEventListener('click', () => {
    setTheme(state.theme === 'dark' ? 'light' : 'dark');
  });
  document.getElementById('openSettingsTop').addEventListener('click', () => { page = 'settings'; render(); });
  document.getElementById('openWidgetTop').addEventListener('click', () => {
    if (api) api.openWidget().then(registered => toast(registered ? 'Mini dictation widget opened · Ctrl/⌘ + Shift + Space' : 'Widget opened; system hotkey unavailable.', registered ? 'success' : 'info')).catch(error => toast(error.message, 'error'));
    else toast('Open the Electron desktop build to use the floating widget.', 'info');
  });

  async function initialize() {
    try {
      const stored = api ? await api.loadState() : JSON.parse(localStorage.getItem('voicestudio-state') || 'null');
      if (stored && typeof stored === 'object') {
        state = { ...defaultState(), ...stored, settings: { ...DEFAULT_SETTINGS, ...(stored.settings || {}) } };
        state.voices = Array.isArray(state.voices) ? state.voices : [];
        state.jobs = Array.isArray(state.jobs) ? state.jobs.map(job => job.status === 'running' ? { ...job, status: 'interrupted', error: 'App closed before the job finished.' } : job) : [];
      }
    } catch (error) { console.warn('Could not load app state:', error); }
    setTheme(state.theme || state.settings.theme || 'dark');
    render();
    if (api) {
      try { runtimeProbe = await api.probeRuntime(state.settings); lastProbeError = runtimeProbe?.error || ''; }
      catch (error) { lastProbeError = error.message; }
      updateChrome();
    } else {
      lastProbeError = 'Desktop runtime is not available in browser preview.';
      updateChrome();
    }
  }

  initialize();
})();
