(() => {
  'use strict';
  const api = window.voiceStudio;
  const $ = id => document.getElementById(id);
  const recordButton = $('recordButton');
  const recordLabel = $('recordLabel');
  const status = $('widgetStatus');
  const hint = $('widgetHint');
  const orb = $('widgetOrb');
  const timer = $('widgetTimer');
  const resultBox = $('widgetResult');
  const copyButton = $('copyButton');
  const progressWrap = $('progressWrap');
  const progressBar = $('progressBar');
  let recorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let clock = null;
  let latestText = '';
  let activeJobId = '';

  const timeText = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  function setStatus(title, detail, mode = '') {
    status.textContent = title;
    hint.textContent = detail;
    orb.className = `widget-orb ${mode}`.trim();
  }
  function stopTracks() {
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  function resetTimer() {
    if (clock) clearInterval(clock);
    clock = null;
  }

  async function begin() {
    if (!api) {
      setStatus('Desktop runtime unavailable', 'Open the VoiceStudio desktop app to use local dictation.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatus('Microphone unavailable', 'Use the full app to import an audio recording.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) options.mimeType = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) options.mimeType = 'audio/ogg;codecs=opus';
      recorder = new MediaRecorder(stream, options);
      chunks = [];
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onstop = finishRecording;
      recorder.start(250);
      startedAt = Date.now();
      recordButton.classList.add('recording');
      recordLabel.textContent = 'Stop recording';
      copyButton.disabled = true;
      latestText = '';
      resultBox.textContent = 'Recording a short note…';
      setStatus('Listening locally', 'Speak naturally. Select Stop recording when you are done.', 'recording');
      resetTimer();
      clock = setInterval(() => { timer.textContent = timeText(Math.floor((Date.now() - startedAt) / 1000)); }, 250);
    } catch (error) {
      stopTracks();
      setStatus('Microphone permission needed', error.message || 'Allow microphone access and try again.');
    }
  }

  async function finishRecording() {
    resetTimer();
    stopTracks();
    recordButton.classList.remove('recording');
    recordLabel.textContent = 'Start recording';
    if (!chunks.length) {
      setStatus('No audio captured', 'Try again or use Import in the full app.');
      return;
    }
    const mime = recorder?.mimeType || 'audio/webm';
    const extension = mime.includes('ogg') ? 'ogg' : 'webm';
    const blob = new Blob(chunks, { type: mime });
    recorder = null;
    recordButton.disabled = true;
    progressWrap.classList.add('visible');
    progressBar.style.width = '7%';
    setStatus('Saving to this device', 'The recording is copied to the VoiceStudio local workspace.', 'working');
    resultBox.textContent = 'Preparing a local transcription…';
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const saved = await api.importAsset(`mini-dictation-${Date.now()}.${extension}`, bytes);
      const stored = await api.loadState();
      const settings = stored?.settings || {};
      activeJobId = `widget-${Date.now()}`;
      setStatus('Transcribing locally', 'Using your configured faster-whisper model. No speech service is contacted.', 'working');
      resultBox.textContent = 'Transcribing…';
      const response = await api.runLocalJob({ action: 'transcribe', input_path: saved.path, settings, jobId: activeJobId });
      if (!response?.ok) throw new Error(response?.error || 'Local transcription did not complete.');
      latestText = response.text || '';
      resultBox.textContent = latestText || 'No speech was recognized.';
      copyButton.disabled = !latestText;
      progressBar.style.width = '100%';
      setStatus(latestText ? 'Transcript ready to paste' : 'No speech recognized', latestText ? 'Copy the text, then paste into your other app.' : 'Try a clearer recording or adjust your local model.');
    } catch (error) {
      resultBox.textContent = error.message || 'Could not transcribe this recording.';
      setStatus('Local transcription unavailable', 'Check Settings for Python, faster-whisper and a local model folder.');
    } finally {
      recordButton.disabled = false;
      window.setTimeout(() => progressWrap.classList.remove('visible'), 700);
    }
  }

  recordButton.addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') recorder.stop();
    else if (!recordButton.disabled) begin();
  });
  copyButton.addEventListener('click', async () => {
    if (!latestText) return;
    try {
      await api.copyText(latestText);
      setStatus('Copied to clipboard', 'Switch to your other app and paste the text.');
    } catch (error) {
      setStatus('Clipboard unavailable', error.message || 'Copy the transcript from the text box manually.');
    }
  });
  $('closeWidget').addEventListener('click', () => api?.closeWidget());
  if (api?.onProgress) {
    api.onProgress(payload => {
      if (payload.jobId === activeJobId) progressBar.style.width = `${Math.max(8, Math.min(96, payload.progress || 8))}%`;
    });
  }
  window.addEventListener('beforeunload', () => { resetTimer(); stopTracks(); });
})();
