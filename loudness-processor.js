// loudness-processor.js
// AudioWorkletProcessor "loudness-processor"
// Rôle : auto-gain basé sur un RMS cible, avec attaque / release lents,
// maxBoost / maxCut, et un floorBoost pour l'effet "wow" garanti.
//
// Graphe global côté extension :
// <video> -> [loudness-processor] -> [limiteur DynamicsCompressorNode] -> destination

class LoudnessProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'targetRms',
        defaultValue: 0.075, // ≈ -14 LUFS
        minValue: 0.0001,
        maxValue: 1.0,
        automationRate: 'k-rate'
      },
      {
        name: 'maxBoostDb',
        defaultValue: 9.0,
        minValue: 0.0,
        maxValue: 24.0,
        automationRate: 'k-rate'
      },
      {
        name: 'maxCutDb',
        defaultValue: 6.0,
        minValue: 0.0,
        maxValue: 24.0,
        automationRate: 'k-rate'
      },
      {
        name: 'floorBoostDb',
        defaultValue: 4.0,
        minValue: 0.0,
        maxValue: 24.0,
        automationRate: 'k-rate'
      },
      {
        name: 'attack', // en secondes (ex : 0.25)
        defaultValue: 0.25,
        minValue: 0.01,
        maxValue: 4.0,
        automationRate: 'k-rate'
      },
      {
        name: 'release', // en secondes (ex : 0.50)
        defaultValue: 0.50,
        minValue: 0.01,
        maxValue: 8.0,
        automationRate: 'k-rate'
      }
    ];
  }

  constructor(options) {
    super(options);

    // Niveau RMS instantané lissé
    this._rms = 0.0;

    // Gain cible et gain appliqué (en dB) pour smoothing attaque / release
    this._currentGainDb = 0.0;
    this._targetGainDb = 0.0;

    // Pré-calcul pour éviter log(0)
    this._eps = 1e-8;
  }

  /**
   * Convertit une amplitude RMS (0..1) en dB FS.
   */
  rmsToDb(rms) {
    return 20 * Math.log10(rms + this._eps);
  }

  /**
   * Convertit des dB en gain linéaire.
   */
  dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  /**
   * Calcul du coefficient de lissage pour un temps (attack/release).
   * timeSeconds = constante de temps approximative.
   */
  timeToCoeff(timeSeconds, sampleRate) {
    // Formule classique : alpha = exp(-1 / (tau * fs))
    const t = Math.max(timeSeconds, 0.001);
    return Math.exp(-1.0 / (t * sampleRate));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    // Pas d'entrée audio -> rien à faire
    if (!input || input.length === 0) {
      // On propage du silence si pas d'input
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }
      return true;
    }

    const channelDataIn = input[0];   // On part du principe qu'on traite au moins un canal
    const channelDataOut = output[0];

    const numSamples = channelDataIn.length;
    const sampleRate = sampleRateGlobal; // hack : mais sampleRate est dispo via globalThis.sampleRate

    // Récupération des paramètres (k-rate -> même valeur pour tout le bloc)
    const targetRms = (parameters.targetRms.length > 0)
      ? parameters.targetRms[0]
      : 0.075;

    const maxBoostDb = (parameters.maxBoostDb.length > 0)
      ? parameters.maxBoostDb[0]
      : 9.0;

    const maxCutDb = (parameters.maxCutDb.length > 0)
      ? parameters.maxCutDb[0]
      : 6.0;

    const floorBoostDb = (parameters.floorBoostDb.length > 0)
      ? parameters.floorBoostDb[0]
      : 4.0;

    const attackSec = (parameters.attack.length > 0)
      ? parameters.attack[0]
      : 0.25;

    const releaseSec = (parameters.release.length > 0)
      ? parameters.release[0]
      : 0.50;

    // 1) Calcul RMS sur ce bloc (mono de référence)
    let sumSq = 0.0;
    for (let i = 0; i < numSamples; i++) {
      const s = channelDataIn[i];
      sumSq += s * s;
    }
    const rmsBlock = Math.sqrt(sumSq / numSamples);

    // Lissage du RMS global (optionnel, mais utile)
    const rmsAttackCoeff = this.timeToCoeff(attackSec, sampleRate);
    this._rms = (1 - rmsAttackCoeff) * rmsBlock + rmsAttackCoeff * this._rms;

    // 2) Calcul du gain cible (en dB) pour rapprocher _rms de targetRms
    const currentDb = this.rmsToDb(this._rms);
    const targetDb = this.rmsToDb(targetRms);

    // Gain théorique pour aller vers le target RMS
    let neededGainDb = targetDb - currentDb;

    // On applique un floorBoost "wow"
    neededGainDb += floorBoostDb;

    // Clamp dans la plage [-maxCutDb, +maxBoostDb]
    if (neededGainDb > maxBoostDb) neededGainDb = maxBoostDb;
    if (neededGainDb < -maxCutDb) neededGainDb = -maxCutDb;

    this._targetGainDb = neededGainDb;

    // 3) Smoothing attaque / release sur le gain en dB
    const attackCoeff = this.timeToCoeff(attackSec, sampleRate);
    const releaseCoeff = this.timeToCoeff(releaseSec, sampleRate);

    let currentGainDb = this._currentGainDb;

    // Si on augmente le gain -> on utilise l'attack
    // Si on diminue -> on utilise le release (plus lent)
    if (this._targetGainDb > currentGainDb) {
      // attaque
      currentGainDb = (1 - attackCoeff) * this._targetGainDb + attackCoeff * currentGainDb;
    } else {
      // release
      currentGainDb = (1 - releaseCoeff) * this._targetGainDb + releaseCoeff * currentGainDb;
    }

    this._currentGainDb = currentGainDb;

    const linearGain = this.dbToLinear(currentGainDb);

    // 4) Application du gain au bloc (mono + copie sur les autres canaux si présents)
    // Canal 0
    for (let i = 0; i < numSamples; i++) {
      channelDataOut[i] = channelDataIn[i] * linearGain;
    }

    // Si plusieurs canaux (stéréo), on applique le même facteur sur les autres canaux
    for (let ch = 1; ch < output.length; ch++) {
      const inCh = input[ch] || input[0];   // fallback sur canal 0 si structure étrange
      const outCh = output[ch];
      for (let i = 0; i < numSamples; i++) {
        outCh[i] = inCh[i] * linearGain;
      }
    }

    return true;
  }
}

// sampleRate n'est pas directement passé mais dispo via globalThis.sampleRate
const sampleRateGlobal = globalThis.sampleRate || 48000;

registerProcessor('loudness-processor', LoudnessProcessor);
