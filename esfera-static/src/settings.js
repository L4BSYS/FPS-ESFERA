// Preferencias de esta máquina: música, efectos, sensibilidad y teclas.
// WASD, flechas, espacio, shift y 1-6 no se reasignan.
(function () {
  window.Game = window.Game || {};
  const Config = window.Game.Config;

  const STORE = 'esfera-static-settings';
  const ACTIONS = ['interact', 'torch', 'pack', 'reload', 'material', 'stairs'];
  const DEFAULTS = {
    interact: 'KeyE',
    torch: 'KeyF',
    pack: 'KeyQ',
    reload: 'KeyR',
    material: 'KeyC',
    stairs: 'KeyV',
  };
  const RESERVED = {
    KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1,
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
    Space: 1, ShiftLeft: 1, ShiftRight: 1, Escape: 1, Tab: 1,
    Digit1: 1, Digit2: 1, Digit3: 1, Digit4: 1, Digit5: 1, Digit6: 1,
  };

  const keys = {
    interact: DEFAULTS.interact,
    torch: DEFAULTS.torch,
    pack: DEFAULTS.pack,
    reload: DEFAULTS.reload,
    material: DEFAULTS.material,
    stairs: DEFAULTS.stairs,
  };
  let music = true;
  let musicVolume = 1;
  let sfx = true;
  let sensitivity = Config.MOUSE_SENSITIVITY;
  const listeners = [];

  function emit() {
    listeners.forEach((fn) => fn());
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        music: music,
        musicVolume: musicVolume,
        sfx: sfx,
        sensitivity: sensitivity,
        keys: keys,
      }));
    } catch (err) { /* el navegador puede bloquear el almacenamiento */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.music === 'boolean') music = data.music;
      if (typeof data.musicVolume === 'number') musicVolume = Math.max(0, Math.min(1, data.musicVolume));
      if (typeof data.sfx === 'boolean') sfx = data.sfx;
      if (typeof data.sensitivity === 'number' && data.sensitivity > 0 && data.sensitivity < 0.05) {
        sensitivity = data.sensitivity;
      }
      if (data.keys) {
        ACTIONS.forEach((action) => {
          const code = data.keys[action];
          if (typeof code === 'string' && /^Key[A-Z]$/.test(code) && !RESERVED[code]) keys[action] = code;
        });
      }
    } catch (err) { /* se queda con los valores de fábrica */ }
  }

  load();
  Config.MOUSE_SENSITIVITY = sensitivity;

  function applyAudio() {
    const audio = window.Game.Audio;
    if (audio && audio.applyMusic) audio.applyMusic();
  }

  window.Game.Settings = {
    ACTIONS: ACTIONS,
    NAMES: {
      interact: 'Interactuar',
      torch: 'Antorcha',
      pack: 'Mochila',
      reload: 'Recarga',
      material: 'Material',
      stairs: 'Escalera',
    },

    onChange(fn) { listeners.push(fn); },

    get music() { return music; },
    get musicVolume() { return musicVolume; },
    get sfx() { return sfx; },
    get sensitivity() { return sensitivity; },

    code(action) { return keys[action] || DEFAULTS[action]; },

    label(action) {
      return (keys[action] || DEFAULTS[action] || '').replace('Key', '');
    },

    setMusic(on) {
      music = !!on;
      save();
      applyAudio();
      emit();
    },

    setMusicVolume(value) {
      musicVolume = Math.max(0, Math.min(1, value));
      save();
      applyAudio();
      emit();
    },

    setSfx(on) {
      sfx = !!on;
      save();
      emit();
    },

    setSensitivity(value) {
      sensitivity = Math.max(0.0005, Math.min(0.01, value));
      Config.MOUSE_SENSITIVITY = sensitivity;
      save();
      emit();
    },

    setKey(action, code) {
      if (!DEFAULTS[action]) return { ok: false, text: 'Esa acción no existe' };
      if (RESERVED[code] || (typeof code === 'string' && code.indexOf('Digit') === 0)) {
        return { ok: false, text: 'Esa tecla está fija' };
      }
      if (!/^Key[A-Z]$/.test(code)) return { ok: false, text: 'Elegí una letra' };
      const names = Object.keys(keys);
      for (let i = 0; i < names.length; i++) {
        if (names[i] !== action && keys[names[i]] === code) {
          return { ok: false, text: 'Esa tecla ya se usa' };
        }
      }
      keys[action] = code;
      save();
      emit();
      return { ok: true, text: '' };
    },
  };
})();
