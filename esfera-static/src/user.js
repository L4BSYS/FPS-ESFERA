// Identidad local del jugador: nombre y color. Hoy se usa en el menú
// (solapa Usuario); mañana es la identidad del multijugador (avatar y tag).
(function () {
  window.Game = window.Game || {};

  const STORE = 'esfera-user-v1';
  const COLORS = ['#33ff66', '#4fc3ff', '#ffb300', '#ff5fa2', '#b78bff', '#ff6b6b'];

  let name = 'Jugador';
  let color = COLORS[0];

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ name: name, color: color }));
    } catch (err) { /* el navegador puede bloquear el almacenamiento */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.name === 'string' && data.name.trim()) {
        name = data.name.trim().slice(0, 16);
      }
      if (typeof data.color === 'string' && COLORS.indexOf(data.color) >= 0) {
        color = data.color;
      }
    } catch (err) { /* se queda con los valores de fábrica */ }
  }

  load();

  window.Game.User = {
    colors() { return COLORS.slice(); },
    get name() { return name; },
    get color() { return color; },
    setName(value) {
      const clean = String(value || '').trim().slice(0, 16) || 'Jugador';
      name = clean;
      save();
      return name;
    },
    setColor(value) {
      if (COLORS.indexOf(value) < 0) return color;
      color = value;
      save();
      return color;
    },
  };
})();
