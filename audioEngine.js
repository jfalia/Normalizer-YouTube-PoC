// audioEngine.js
// Nouvelle version :
// - AudioContext unique par onglet
// - Graph :
//     <video> -> src
//       ├──> rawGain ───────────────────────────────────────► destination
//       └──> loudness-processor -> limiter -> procGain ─────► destination
// - ON / OFF = bascule entre rawGain et procGain (aucune
//   modification de video.muted / video.volume).
// - BONUS : chemin traité légèrement plus fort (+2 dB) pour
//   un effet "wow" plus perceptible.

(() => {
  const CONFIG = {
    targetRms: 0.075,   // ≈ -14 LUFS approx
    maxBoostDb: 9.0,
    maxCutDb: 6.0,
    floorBoostDb: 4.0,  // effet "wow"
    attack: 0.25,
    release: 0.50,
    limiter: {
      threshold: -3,
      knee: 0,
      ratio: 20,
      attack: 0.003,
      release: 0.15
    }
  };

  // +2 dB sur le chemin traité
  const EXTRA_BOOST_DB = 2.0;
  const EXTRA_BOOST_LINEAR = Math.pow(10, EXTRA_BOOST_DB / 20);

  const STATE = {
    ctx: null,
    workletLoaded: false,
    currentVideo: null,
    source: null,
    workletNode: null,
    limiterNode: null,
    rawGain: null,
    procGain: null,
    enabled: false
  };

  function log(...args) {
    console.log('[Normalizer engine]', ...args);
  }

  async function ensureContext() {
    if (STATE.ctx) return STATE.ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      console.warn('[Normalizer] AudioContext non supporté dans ce navigateur.');
      return null;
    }
    const ctx = new Ctor();
    STATE.ctx = ctx;
    return ctx;
  }

  async function ensureWorkletLoaded() {
    if (!STATE.ctx || STATE.workletLoaded) return;

    const url = chrome.runtime.getURL('loudness-processor.js');
    log('Tentative de chargement du worklet depuis :', url);

    try {
      await STATE.ctx.audioWorklet.addModule(url);
      STATE.workletLoaded = true;
      log('Worklet loudness-processor chargé avec succès.');
    } catch (e) {
      console.error(
        '[Worklet ERROR] Échec du chargement de loudness-processor.js :',
        e && e.message,
        e
      );
      STATE.workletLoaded = false;
    }
  }

  function teardownGraph() {
    try { if (STATE.source) STATE.source.disconnect(); } catch {}
    try { if (STATE.workletNode) STATE.workletNode.disconnect(); } catch {}
    try { if (STATE.limiterNode) STATE.limiterNode.disconnect(); } catch {}
    try { if (STATE.rawGain) STATE.rawGain.disconnect(); } catch {}
    try { if (STATE.procGain) STATE.procGain.disconnect(); } catch {}

    STATE.source = null;
    STATE.workletNode = null;
    STATE.limiterNode = null;
    STATE.rawGain = null;
    STATE.procGain = null;
    STATE.currentVideo = null;
  }

  function buildGraphFor(video) {
    if (!STATE.ctx || !STATE.workletLoaded || !video) {
      if (!STATE.workletLoaded) {
        log('buildGraphFor: worklet non chargé, on ne construit pas le graphe.');
      }
      return;
    }

    // Si le graphe est déjà construit pour cette vidéo, ne rien faire
    if (STATE.currentVideo === video && STATE.source && STATE.rawGain && STATE.procGain) {
      log('Graphe déjà construit pour cette vidéo, on ne reconstruit pas.');
      return;
    }

    // Si une autre vidéo était attachée, démonte le graphe précédent
    if (STATE.currentVideo && STATE.currentVideo !== video) {
      teardownGraph();
    }

    STATE.currentVideo = video;

    const ctx = STATE.ctx;

    // 1) Source à partir de l'élément <video>
    const src = ctx.createMediaElementSource(video);

    // 2) Chemin brut : <video> -> rawGain -> destination
    const rawGain = ctx.createGain();
    // OFF = 1.0, ON = 0.0 (géré par enable/disable)
    rawGain.gain.value = STATE.enabled ? 0.0 : 1.0;

    // 3) Worklet loudness-processor (chemin traité)
    const workletNode = new AudioWorkletNode(ctx, 'loudness-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: {
        targetRms:   CONFIG.targetRms,
        maxBoostDb:  CONFIG.maxBoostDb,
        maxCutDb:    CONFIG.maxCutDb,
        floorBoostDb: CONFIG.floorBoostDb,
        attack:      CONFIG.attack,
        release:     CONFIG.release
      }
    });

    // 4) Limiteur final
    const limiter = ctx.createDynamicsCompressor();
    const t = ctx.currentTime;
    limiter.threshold.setValueAtTime(CONFIG.limiter.threshold, t);
    limiter.knee.setValueAtTime(CONFIG.limiter.knee, t);
    limiter.ratio.setValueAtTime(CONFIG.limiter.ratio, t);
    limiter.attack.setValueAtTime(CONFIG.limiter.attack, t);
    limiter.release.setValueAtTime(CONFIG.limiter.release, t);

    // 5) Chemin traité : <video> -> worklet -> limiter -> procGain -> destination
    const procGain = ctx.createGain();
    // ON = EXTRA_BOOST_LINEAR (~ +2 dB), OFF = 0.0
    procGain.gain.value = STATE.enabled ? EXTRA_BOOST_LINEAR : 0.0;

    // Connexions
    src.connect(rawGain).connect(ctx.destination);
    src.connect(workletNode).connect(limiter).connect(procGain).connect(ctx.destination);

    STATE.source = src;
    STATE.rawGain = rawGain;
    STATE.workletNode = workletNode;
    STATE.limiterNode = limiter;
    STATE.procGain = procGain;

    log('Graphe audio construit (double chemin brut/traité, +2 dB sur traité).');
  }

  // API publique

  async function attachTo(videoElement) {
    const ctx = await ensureContext();
    if (!ctx) return;

    await ensureWorkletLoaded();
    if (!STATE.workletLoaded) {
      log('attachTo: worklet non chargé, on abandonne attachTo() pour cette vidéo.');
      return;
    }

    buildGraphFor(videoElement);
  }

  function detach() {
    teardownGraph();
  }

  // ON = procGain EXTRA_BOOST_LINEAR, rawGain 0
  async function enable() {
    if (STATE.enabled) return;
    STATE.enabled = true;

    const ctx = await ensureContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {
        console.warn('[Normalizer] ctx.resume() a échoué ou a été bloqué :', e && e.message);
      }
    }

    if (STATE.rawGain && STATE.procGain) {
      const t = ctx.currentTime || 0;
      STATE.rawGain.gain.setValueAtTime(0.0, t);
      STATE.procGain.gain.setValueAtTime(EXTRA_BOOST_LINEAR, t);
    }

    log('Normalizer ENABLED (chemin traité ON (+2 dB), brut OFF).');
  }

  // OFF = procGain 0, rawGain 1
  function disable() {
    if (!STATE.enabled) return;
    STATE.enabled = false;

    const ctx = STATE.ctx;
    if (ctx && STATE.rawGain && STATE.procGain) {
      const t = ctx.currentTime || 0;
      STATE.rawGain.gain.setValueAtTime(1.0, t);
      STATE.procGain.gain.setValueAtTime(0.0, t);
    }

    log('Normalizer DISABLED (chemin brut ON, traité OFF).');
  }

  window.AudioEngine = {
    attachTo,
    detach,
    enable,
    disable
  };
})();
