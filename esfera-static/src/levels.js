// Niveles del juego: cada nivel es un planeta (una escena).
// El tutorial trae todas las mecánicas para probar; los niveles son mundos
// limpios con recursos por zonas, enemigos y una misión (llave → puerta).
// Cada nivel recarga la página (?level=N): estado 100% limpio, inventario
// vacío, misma semilla = mismo planeta en todas las máquinas. El online
// (cuando exista) solo sincronizaría lo que cambia, igual que la semilla.
(function () {
  window.Game = window.Game || {};

  const STORE_UNLOCK = 'esfera-levels-unlocked-v1';

  // Radio del planeta por nivel. El tutorial es chico a propósito (se
  // cruza caminando en un rato); el nivel 1 es planeta completo.
  const LEVELS = [
    {
      id: 0,
      key: 'tutorial',
      name: 'Tutorial',
      planetRadius: 100,
      seed: 1337,
      // 'tutorial' = patio completo (tótems, herramientas, nodos de muestra).
      // 'clean' = mundo vacío: solo puerta + llave, anillo de spawn y sistemas
      // (mesa, territorio, construcción). Los recursos los pone wilds por zonas.
      mode: 'tutorial',
      mission: 'Aprendé lo básico, agarrá la llave y abrí la puerta de las antípodas.',
      next: 1,
      waves: true,
      creator: true,
      guards: 2, // tutorial amable: la pistola se regala, 2 robots alcanzan
      wilds: { count: 48, bandMin: 0.05, bandMax: 3.09, camps: 6, loosies: 40, landmarks: 22, food: 38, toxin: 40, critters: 32 },
      // Gancho multijugador: el nivel 1 es donde va a vivir. Mismo planeta
      // para todos (semilla) + sincronizar solo deltas (ver seed.js).
      // El sector plano de FPS/js/17-net.js no sirve en la esfera: allá los
      // sectores van a ser celdas del chart (ix,iz con su hemisferio).
      net: { enabled: false },
    },
    {
      id: 1,
      key: 'nivel1',
      name: 'Nivel 1',
      planetRadius: 500,
      seed: 4242,
      mode: 'clean',
      mission: 'Mundo nuevo, mochila vacía: juntá recursos por zonas, sobreviví y abrí la puerta.',
      next: null, // todavía no hay nivel 2: la puerta avisa "próximamente"
      waves: true,
      creator: true,
      guards: 3, // puerta bien cuidada: hay que ir armado de verdad
      // Zonas en casi todo el planeta (banda ancha en ángulo desde el polo).
      wilds: { count: 120, bandMin: 0.05, bandMax: 3.09, camps: 8, loosies: 480, landmarks: 130, food: 240, toxin: 140, critters: 100 },
      net: { enabled: false },
    },
  ];

  function levelFromUrl() {
    try {
      const m = /[?&]level=(\d+)/.exec(window.location.search || '');
      if (m) return parseInt(m[1], 10);
    } catch (e) {}
    return 0;
  }

  function unlocked() {
    try {
      const raw = localStorage.getItem(STORE_UNLOCK);
      if (!raw) return [0];
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) return list;
    } catch (e) {}
    return [0];
  }

  window.Game.Levels = {
    list() { return LEVELS; },
    get(id) {
      for (let i = 0; i < LEVELS.length; i++) {
        if (LEVELS[i].id === id) return LEVELS[i];
      }
      return LEVELS[0];
    },
    current() {
      const id = levelFromUrl();
      const def = window.Game.Levels.get(id);
      // Sin desbloqueo no hay salto: el portal del tutorial desbloquea.
      // ?dev=1 lo saltea (herramienta de desarrollo).
      let dev = false;
      try {
        dev = /(^|[?&])dev=1/.test(window.location.search || '');
      } catch (e) {}
      if (!dev) {
        const ok = unlocked();
        if (ok.indexOf(def.id) < 0) return window.Game.Levels.get(0);
      }
      return def;
    },
    isUnlocked(id) {
      return unlocked().indexOf(id) >= 0;
    },
    unlock(id) {
      try {
        const ok = unlocked();
        if (ok.indexOf(id) < 0) {
          ok.push(id);
          localStorage.setItem(STORE_UNLOCK, JSON.stringify(ok));
        }
        return true;
      } catch (e) {
        return false;
      }
    },
    // Salto de mundo: recarga limpia (?level=N). El inventario arranca vacío
    // porque es carga fresca; lo único que viaja es la lista de desbloqueos.
    portalTo(id) {
      const def = window.Game.Levels.get(id);
      window.Game.Levels.unlock(def.id);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('level', String(def.id));
        url.searchParams.delete('seed');
        window.location.href = url.toString();
      } catch (e) {
        window.location.search = '?level=' + def.id;
      }
    },
    // Guardado del creador por nivel: lo construido en un mundo no aparece
    // en otro. El tutorial (nivel 0, el único que existía) conserva la llave
    // vieja para no borrarle a nadie su mundo.
    creatorStore(id) {
      if (id === 0) return 'esfera-creator-v1';
      return 'esfera-creator-v1-l' + id;
    },
  };
})();
