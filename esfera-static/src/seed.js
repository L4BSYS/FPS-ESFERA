// Semilla del mapa: con la misma semilla, todas las máquinas generan el
// mismo planeta (rocas + recursos). Así cada jugador carga localmente el
// mismo mapa (?seed=N en la URL) y el online solo tendría que sincronizar
// lo que cambia: jugadores, bloques y mesas.
(function () {
  window.Game = window.Game || {};

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  window.Game.makeRng = function (seed) {
    return mulberry32((seed || 0) >>> 0);
  };

  window.Game.seedFromUrl = function (fallback) {
    try {
      const m = /[?&]seed=(-?\d+)/.exec(window.location.search || '');
      if (m) return parseInt(m[1], 10) >>> 0;
    } catch (e) {}
    return (fallback || 0) >>> 0;
  };
})();
