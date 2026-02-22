// ui.js
// Injecte un bouton ON/OFF dans le player YouTube.
// Ce bouton modifie uniquement chrome.storage.local.AN_enabled.
// Toute la logique audio est gérée par content.js + audioEngine.js.

(() => {
  const UI = {
    button: null,
    lastState: null
  };

  function log(...args) {
    console.log('[Normalizer UI]', ...args);
  }

  /**
   * Crée ou retourne le conteneur overlay du player YouTube.
   * On l'injecte dans la barre de contrôles (zone droite).
   */
  function getPlayerControlsContainer() {
    // Sélecteur plus robuste : zone droite des contrôles YouTube
    const container = document.querySelector('.ytp-right-controls');
    return container || null;
  }

  /**
   * Crée le bouton Normalizer si nécessaire.
   */
  function createButton() {
    if (UI.button) return UI.button;

    const btn = document.createElement('div');
    btn.id = 'normalizer-toggle-btn';

    // Style minimal compatible YouTube
    btn.style.width = '32px';
    btn.style.height = '32px';
    btn.style.borderRadius = '4px';
    btn.style.marginLeft = '8px';
    btn.style.cursor = 'pointer';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.fontSize = '13px';
    btn.style.fontWeight = 'bold';
    btn.style.color = '#fff';
    btn.style.userSelect = 'none';

    // Transition visuelle douce
    btn.style.transition = 'background-color 120ms ease, transform 80ms ease';

    // Petit effet hover
    btn.addEventListener('mouseenter', () => (btn.style.transform = 'scale(1.08)'));
    btn.addEventListener('mouseleave', () => (btn.style.transform = 'scale(1.0)'));

    // Au clic : toggle AN_enabled
    btn.addEventListener('click', () => {
      const newVal = !UI.lastState;
      chrome.storage.local.set({ AN_enabled: newVal });
    });

    UI.button = btn;
    return btn;
  }

  /**
   * Met à jour l'apparence du bouton selon l'état ON/OFF
   */
  function updateButtonAppearance(enabled) {
    if (!UI.button) return;

    UI.lastState = enabled;

    if (enabled) {
      UI.button.style.backgroundColor = '#d72638'; // rouge ON
      UI.button.textContent = 'ON';
    } else {
      UI.button.style.backgroundColor = '#0984e3'; // bleu électrique OFF
      UI.button.textContent = 'OFF';
    }
  }

  /**
   * Injecte le bouton dans le player dès que possible.
   */
  function injectButton() {
    const container = getPlayerControlsContainer();
    if (!container) return false;

    const btn = createButton();

    if (!container.contains(btn)) {
      container.insertBefore(btn, container.firstChild);
      log('Bouton Normalizer injecté dans le player.');
    }

    // Si on connaît déjà l'état (lastState), on applique l'apparence
    if (UI.lastState !== null) {
      updateButtonAppearance(UI.lastState);
    }

    return true;
  }

  /**
   * Démarre un observer pour réinjecter le bouton
   * si YouTube recrée son player (navigation interne SPA).
   * ⚠️ On limite l'observation au conteneur du player pour éviter de surcharger la page.
   */
  function startObserver() {
    const target = document.getElementById('movie_player');
    if (!target) {
      log('Impossible de trouver #movie_player pour l’observer, on restera sur l’injection périodique.');
      return;
    }

    const obs = new MutationObserver(() => {
      injectButton();
    });

    obs.observe(target, { childList: true, subtree: true });
  }

  /**
   * Initialisation UI :
   * - lire AN_enabled
   * - tenter régulièrement d'injecter le bouton
   * - mettre l'apparence correcte
   */
  function initUI() {
    chrome.storage.local.get({ AN_enabled: true }, (res) => {
      const initial = Boolean(res.AN_enabled);
      UI.lastState = initial; // on mémorise l'état pour future injection
      if (injectButton()) {
        updateButtonAppearance(initial);
      }
    });

    // Essayer régulièrement d'injecter tant que le player n'est pas prêt
    const tryInterval = setInterval(() => {
      if (injectButton()) {
        clearInterval(tryInterval);
      }
    }, 300);

    startObserver();

    // Lorsqu'un autre onglet modifie AN_enabled, mettre à jour l'UI
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'AN_enabled' in changes) {
        const enabled = Boolean(changes.AN_enabled.newValue);
        UI.lastState = enabled;
        updateButtonAppearance(enabled);
      }
    });
  }

  // Lancement
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initUI();
  } else {
    window.addEventListener('DOMContentLoaded', initUI, { once: true });
  }
})();
