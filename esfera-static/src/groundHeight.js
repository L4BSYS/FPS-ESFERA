(function () {
  window.Game = window.Game || {};

  const providers = [];

  window.Game.GroundHeight = {
    /** Registra una función (worldPos) => alturaExtra (0 si no aplica) */
    register(fn) {
      providers.push(fn);
    },
    unregister(fn) {
      const index = providers.indexOf(fn);
      if (index >= 0) providers.splice(index, 1);
    },
    get(worldPos) {
      let maxExtra = 0;
      for (const fn of providers) {
        const h = fn(worldPos);
        if (h > maxExtra) maxExtra = h;
      }
      return maxExtra;
    },
  };
})();
