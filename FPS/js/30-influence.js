// js/30-influence.js (part 30). LaGrieta FPS — aporte de influencia.
//
// Convierte lo que hacés en la partida en un puntaje de FPS y lo reporta a
// `reportGameScore`, que acredita el 100% al bando del jugador.
//
// Qué suma (todo medido en la sesión actual, nunca en pausa ni en segundo plano):
//   - Tiempo jugado:        1.000 pts por minuto (con techo anti-idle)
//   - Bloques colocados:       25 pts cada uno
//   - Bajas:                  250 pts cada una
//   - Oleada máxima:          800 pts por oleada
//   - Pruebas de tiempo:  600.000 / segundos (bonus por prueba terminada)
//
// El tiempo tiene un techo: no puede aportar más que el doble de lo que
// aportaron las acciones (bloques, bajas, oleadas, pruebas) más 3 minutos
// de gracia. Así dejar el juego abierto no infla el puntaje.
//
// El servidor guarda el MEJOR puntaje histórico de cada jugador y sólo
// acredita la diferencia. Así no se puede farmear repitiendo la misma
// partida: sólo cuenta superarte. El tope por jugador y juego es 5.000 de
// influencia (INFLUENCE_PER_PLAYER_CAP en functions/index.js).

(function () {
  'use strict';

  var SCORE = {
    perMinute: 1000,
    perBlock: 25,
    perKill: 250,
    perWave: 800,
    trialBase: 600000
  };

  var REPORT_EVERY_MS = 45000;
  var MAX_SCORE = 100000000;

  var state = {
    blocks: 0,
    maxWave: 0,
    trialBonus: 0,
    trials: 0,
    lastReported: 0,
    lastReportAt: 0,
    reporting: false,
    started: false
  };

  function sessionSeconds() {
    try {
      if (typeof fpsProgressSessionSeconds === 'function') {
        return Math.max(0, Number(fpsProgressSessionSeconds()) || 0);
      }
    } catch (e) {}
    return 0;
  }

  function readKills() {
    try { return Math.max(0, Number(enemiesKilled) || 0); } catch (e) { return 0; }
  }

  function readWave() {
    try { return Math.max(0, Number(waveNumber) || 0); } catch (e) { return 0; }
  }

  // Modos donde construir no cuesta recursos ni implica riesgo: no deben
  // regalar influencia. Cubre el creador, el tutorial y el playground.
  function countsForInfluence() {
    try {
      if (typeof creatorMode !== 'undefined' && creatorMode) return false;
      if (typeof DIRECTOR !== 'undefined' && DIRECTOR && DIRECTOR.active) return false;
      if (typeof LEVEL !== 'undefined' && LEVEL) {
        if (LEVEL.current === 'tutorial' || LEVEL.current === 'playground') {
          return false;
        }
        if (LEVEL.working) return false;
      }
    } catch (e) {}
    return true;
  }

  function isPlaying() {
    try {
      if (!countsForInfluence()) return false;
      if (document.hidden) return false;
      if (typeof isGamePaused === 'undefined' || isGamePaused) return false;
      if (typeof LEVEL !== 'undefined' && LEVEL) {
        if (LEVEL.menuOpen || LEVEL.loading) return false;
      }
      if (typeof player === 'undefined' || !player) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function formatNumber(value) {
    try { return Number(value || 0).toLocaleString('es-AR'); } catch (e) {
      return String(Math.round(Number(value) || 0));
    }
  }

  /**
   * Desglose del puntaje de la sesión. Es la fuente de verdad para el HUD,
   * el menú y el reporte al servidor.
   *
   * @return {object} Totales y componentes del score.
   */
  function breakdown() {
    var seconds = sessionSeconds();
    var kills = readKills();
    var wave = Math.max(state.maxWave, readWave());
    var blocks = Math.max(0, state.blocks);
    var blockScore = blocks * SCORE.perBlock;
    var killScore = kills * SCORE.perKill;
    var waveScore = wave * SCORE.perWave;
    // El tiempo no puede dominar el score: techo = 2x acciones + 3 min.
    var actionScore = blockScore + killScore + waveScore + state.trialBonus;
    var timeCap = actionScore * 2 + SCORE.perMinute * 3;
    var timeScore = Math.min(
      Math.round((seconds / 60) * SCORE.perMinute),
      timeCap
    );
    var total = timeScore + actionScore;
    return {
      total: Math.min(MAX_SCORE, Math.max(0, Math.round(total))),
      timeScore: timeScore,
      blockScore: blockScore,
      killScore: killScore,
      waveScore: waveScore,
      trialBonus: Math.round(state.trialBonus),
      seconds: seconds,
      blocks: blocks,
      kills: kills,
      wave: wave,
      trials: state.trials
    };
  }

  function scoreText() {
    return formatNumber(breakdown().total) + ' pts';
  }

  /**
   * Envía el mejor puntaje de la sesión. Silencioso si no hay sesión,
   * bando o Firebase Functions. El servidor deduplica por jugador.
   *
   * @param {boolean} force Ignora el último puntaje reportado.
   * @return {Promise<object|null>} Resultado de la Cloud Function.
   */
  function report(force) {
    var data = breakdown();
    if (data.total <= 0) return Promise.resolve(null);
    if (!force && data.total <= state.lastReported) return Promise.resolve(null);
    if (state.reporting && !force) return Promise.resolve(null);

    var api = window.LaGrietaInfluence;
    if (!api || typeof api.report !== 'function') return Promise.resolve(null);

    var user = null;
    try { user = firebase.auth().currentUser; } catch (e) { user = null; }
    if (!user) return Promise.resolve(null);

    state.reporting = true;
    state.lastReportAt = Date.now();

    return api.report('fps', data.total, {
      seconds: Math.round(data.seconds),
      blocks: data.blocks,
      kills: data.kills,
      wave: data.wave,
      trials: data.trials,
      trialBonus: data.trialBonus,
      level: (typeof LEVEL !== 'undefined' && LEVEL && LEVEL.current) || null
    }).then(function (result) {
      state.lastReported = Math.max(state.lastReported, data.total);
      if (result && result.improved) {
        try {
          if (typeof lvToast === 'function') {
            lvToast('+' + result.influence + ' de influencia para tu bando');
          }
        } catch (e) {}
      }
      return result;
    }).catch(function (error) {
      console.warn('No se pudo reportar la influencia del FPS:', error);
      return null;
    }).then(function (result) {
      state.reporting = false;
      return result;
    });
  }

  function tick() {
    var wave = readWave();
    if (wave > state.maxWave) state.maxWave = wave;
    if (!isPlaying()) return;
    var now = Date.now();
    if (now - state.lastReportAt >= REPORT_EVERY_MS) report(false);
  }

  function start() {
    if (state.started) return;
    state.started = true;
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) report(true);
    });
    window.addEventListener('pagehide', function () { report(true); });
    window.addEventListener('beforeunload', function () { report(true); });
  }

  /* ------------------------------------------------------------------ */
  /* API pública para el resto del FPS                                   */
  /* ------------------------------------------------------------------ */

  // Se llama desde 08-build.js cada vez que el jugador coloca un bloque.
  window.fpsInfluenceBlockPlaced = function () {
    if (!countsForInfluence()) return;
    state.blocks += 1;
  };

  // Se llama desde 18-trial.js al terminar una prueba de tiempo.
  window.fpsInfluenceTrialFinished = function (trialId, ms) {
    var seconds = Math.max(1, Number(ms) / 1000);
    var bonus = Math.round(SCORE.trialBase / seconds);
    state.trialBonus += bonus;
    state.trials += 1;
    report(true);
    return bonus;
  };

  window.fpsInfluenceBreakdown = breakdown;
  window.fpsInfluenceScore = function () { return breakdown().total; };
  window.fpsInfluenceScoreText = scoreText;
  window.fpsInfluenceFormat = formatNumber;
  window.fpsInfluenceReport = report;

  start();
})();
