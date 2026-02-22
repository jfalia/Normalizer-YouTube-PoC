// content.js
// Injecté sur toutes les pages https://www.youtube.com/*
// Rôle :
// - détecter l'élément <video> principal de YouTube
// - connecter cette vidéo à AudioEngine
// - suivre les changements de vidéo (SPA YouTube)
// - activer/désactiver Normalizer en fonction du flag global AN_enabled (chrome.storage.local)

(() => {
  const STATE = {
    enabled: false,
    currentVideo: null,
    observer: null,
    audioEngineReady: false
  };

  function log(...args) {
    console.log('[Normalizer content]', ...args);
  }

  /**
   * TROUVE la "vraie" vidéo principale du player YouTube.
   */
  function findMainVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    for (const v of videos) {
      if (!v) continue;
      if (v.readyState === 0 && !v.src && !v.querySelector('source')) continue;
      return v;
    }
    return null;
  }

  /**
   * Attache AudioEngine à une nouvelle vidéo si nécessaire.
   * VERSION DEBUG : pas de wait/polling agressif, on vérifie juste si AudioEngine est prêt.
   */
  async function attachToCurrentVideoIfNeeded() {
    if (!window.AudioEngine || typeof window.AudioEngine.attachTo !== 'function') {
      log('AudioEngine non disponible pour cet appel, on abandonne sans attendre.');
      return;
    }

    const video = findMainVideo();
    if (!video) {
      // Aucun <video> trouvé pour l’instant (page pas encore prête ?)
      return;
    }

    if (video === STATE.currentVideo) {
      // Rien à faire, on est déjà connecté à cette vidéo.
      return;
    }

    STATE.currentVideo = video;
    STATE.audioEngineReady = true;
    log('Nouveau <video> détecté, attache AudioEngine.');

    try {
      await window.AudioEngine.attachTo(video);
    } catch (e) {
      console.error('[Normalizer content] Erreur attachTo:', e);
      return;
    }

    // Si l'état global est ON, on s'assure que l'audio est traité.
    if (STATE.enabled) {
      try {
        await window.AudioEngine.enable();
      } catch (e) {
        console.error('[Normalizer content] Erreur enable():', e);
      }
    }
  }

  /**
   * Active Normalizer globalement dans cet onglet.
   * (pour l'utilisateur : état ON)
   */
  async function enableGlobal() {
    if (STATE.enabled) return;
    STATE.enabled = true;
    log('Activation globale de Normalizer dans cet onglet.');

    await attachToCurrentVideoIfNeeded();

    if (window.AudioEngine && typeof window.AudioEngine.enable === 'function') {
      try {
        await window.AudioEngine.enable();
      } catch (e) {
        console.error('[Normalizer content] Erreur enableGlobal/enable():', e);
      }
    }
  }

  /**
   * Désactive Normalizer globalement dans cet onglet.
   * (pour l'utilisateur : état OFF)
   */
  function disableGlobal() {
    if (!STATE.enabled) return;
    STATE.enabled = false;
    log('Désactivation globale de Normalizer dans cet onglet.');

    if (window.AudioEngine && typeof window.AudioEngine.disable === 'function') {
      try {
        window.AudioEngine.disable();
      } catch (e) {
        console.error('[Normalizer content] Erreur disableGlobal/disable():', e);
      }
    }
    // Pour le PoC, on laisse le graphe attaché.
  }

  /**
   * Observe le DOM pour détecter les changements de vidéo (navigation SPA YouTube).
   * VERSION DEBUG : on scope d'abord sur #movie_player si possible.
   */
  function startObserving() {
    if (STATE.observer) return;

    const target = document.getElementById('movie_player') || document.documentElement;

    STATE.observer = new MutationObserver(() => {
      attachToCurrentVideoIfNeeded();
    });

    STATE.observer.observe(target, {
      childList: true,
      subtree: true
    });

    log('MutationObserver démarré (scopé sur le player si possible).');
  }

  function stopObserving() {
    if (STATE.observer) {
      STATE.observer.disconnect();
      STATE.observer = null;
      log('MutationObserver arrêté.');
    }
  }

  /**
   * Initialisation : lit l'état global AN_enabled
   * et installe les écouteurs nécessaires.
   */
  function init() {
    chrome.storage.local.get({ AN_enabled: true }, async (res) => {
      const initial = Boolean(res.AN_enabled);
      STATE.enabled = initial;
      log('État initial AN_enabled =', initial);

      if (initial) {
        await enableGlobal();
      } else {
        await attachToCurrentVideoIfNeeded();
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !('AN_enabled' in changes)) return;
      const val = Boolean(changes.AN_enabled.newValue);
      log('Changement AN_enabled détecté =', val);
      if (val) {
        enableGlobal();
      } else {
        disableGlobal();
      }
    });

    startObserving();
    attachToCurrentVideoIfNeeded();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
