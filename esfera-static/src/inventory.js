(function () {
  window.Game = window.Game || {};

  const TOOLS = [
    { id: 'hands', name: 'Manos', key: '1' },
    { id: 'axe', name: 'Hacha', key: '2' },
    { id: 'pickaxe', name: 'Pico', key: '3' },
    { id: 'hammer', name: 'Martillo', key: '4' },
    { id: 'pistol', name: 'Pistola', key: '5' },
    { id: 'torch', name: 'Antorcha', key: '6' },
  ];

  // Pilas: antorchas y vendas. La comida y la toxina se consumen al
  // tocarlas (vos y los robots): no son inventario. La venda sí se guarda
  // y se usa cuando el jugador dispone (desde la mochila).
  const STACK_MAX = { torch: 6, bandage: 3 };

  const resources = { wood: 0, stone: 0, metal: 0 };
  const stacks = { torch: 0, bandage: 0 };
  const keys = {};
  const owned = { hands: true };
  // Cinturón configurable: subconjunto ordenado de TOOLS. Las manos van
  // siempre primeras y no se sacan. Las teclas 1-6 mapean a estos lugares.
  let belt = TOOLS.map((entry) => entry.id);
  let active = 'hands';
  const listeners = [];

  function snapshot() {
    return {
      resources: { wood: resources.wood, stone: resources.stone, metal: resources.metal },
      stacks: { torch: stacks.torch, bandage: stacks.bandage || 0 },
      active,
      hasKey: !!keys.golden_key,
      owned: Object.assign({}, owned),
      belt: belt.slice(),
    };
  }

  function emit() {
    const snap = snapshot();
    listeners.forEach((fn) => fn(snap));
  }

  function clearAll() {
    resources.wood = 0;
    resources.stone = 0;
    resources.metal = 0;
    stacks.torch = 0;
    stacks.bandage = 0;
    Object.keys(keys).forEach((id) => { delete keys[id]; });
    Object.keys(owned).forEach((id) => { delete owned[id]; });
    owned.hands = true;
    belt = TOOLS.map((entry) => entry.id);
    pruneBelt();
    active = 'hands';
  }

  // Lugares del cinturón en orden, con tecla 1..N y estado.
  function beltSlots() {
    const slots = [];
    belt.forEach((id) => {
      const tool = TOOLS.find((entry) => entry.id === id);
      if (!tool) return;
      slots.push({
        id: tool.id,
        name: tool.name,
        key: String(slots.length + 1),
        owned: !!owned[tool.id],
        active: active === tool.id,
        assigned: true,
      });
    });
    return slots;
  }

  function beltOrder() {
    const order = TOOLS.map((entry) => entry.id);
    belt.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  function pruneBelt() {
    belt = belt.filter((id) => id === 'hands' || owned[id]);
    if (!belt.length || belt[0] !== 'hands') {
      belt = ['hands'].concat(belt.filter((id) => id !== 'hands'));
    }
  }

  window.Game.Inventory = {
    TOOLS,

    onChange(fn) {
      listeners.push(fn);
      fn(snapshot());
    },

    get state() { return snapshot(); },

    toolName(id) {
      const tool = TOOLS.find((entry) => entry.id === id);
      return tool ? tool.name : id;
    },

    hasTool(id) { return !!owned[id]; },

    giveTool(id) {
      if (!TOOLS.some((entry) => entry.id === id)) return false;
      const fresh = !owned[id];
      owned[id] = true;
      // Lo nuevo entra al cinturón (si hay lugar) y se equipa.
      if (fresh && belt.indexOf(id) < 0 && belt.length < 6) belt.push(id);
      beltOrder();
      pruneBelt();
      if (fresh && id !== 'hands') active = id;
      emit();
      return fresh;
    },

    setTool(id) {
      if (!owned[id]) return false;
      active = id;
      emit();
      return true;
    },

    /** El cinturón se configura desde la mochila: qué entra y qué sale.
        Las manos no salen nunca. Devuelve true si cambió algo. */
    assignBelt(id, on) {
      if (!TOOLS.some((entry) => entry.id === id) || id === 'hands') return false;
      const at = belt.indexOf(id);
      if (on && at < 0 && owned[id] && belt.length < 6) {
        // Orden estable: en el lugar que le toca por TOOLS.
        belt.push(id);
        beltOrder();
        emit();
        return true;
      }
      if (!on && at >= 0) {
        belt.splice(at, 1);
        if (active === id) active = 'hands';
        emit();
        return true;
      }
      return false;
    },

    beltAssigned(id) { return belt.indexOf(id) >= 0; },

    beltSlots() { return beltSlots(); },

    /** Tecla 1..N → herramienta del lugar (o null si no hay). */
    slotForCode(n) {
      const slots = beltSlots();
      if (n < 1 || n > slots.length) return null;
      return slots[n - 1].owned ? slots[n - 1].id : null;
    },

    /** Rueda y touchpad: salta a la siguiente herramienta del cinturón. */
    cycleTool(dir) {
      const have = beltSlots().filter((entry) => entry.owned);
      if (!have.length) return false;
      let index = have.findIndex((entry) => entry.id === active);
      if (index < 0) index = 0;
      const step = dir >= 0 ? 1 : -1;
      const next = have[(index + step + have.length) % have.length];
      if (next.id === active) return true;
      active = next.id;
      emit();
      return true;
    },

    get activeTool() { return active; },

    addResource(type, amount) {
      if (resources[type] == null) return;
      resources[type] += amount;
      emit();
    },

    count(type) { return resources[type] || 0; },

    trySpend(cost) {
      const names = Object.keys(cost);
      for (let i = 0; i < names.length; i++) {
        if ((resources[names[i]] || 0) < cost[names[i]]) return false;
      }
      names.forEach((name) => { resources[name] -= cost[name]; });
      emit();
      return true;
    },

    stackMax(id) { return STACK_MAX[id] || 1; },

    stackCount(id) { return stacks[id] || 0; },

    addStack(id, amount) {
      if (stacks[id] == null) return 0;
      const room = (STACK_MAX[id] || 1) - stacks[id];
      const added = Math.max(0, Math.min(room, amount));
      if (added <= 0) return 0;
      stacks[id] += added;
      emit();
      return added;
    },

    takeStack(id, amount) {
      if (stacks[id] == null || stacks[id] <= 0) return 0;
      const taken = Math.min(stacks[id], amount);
      stacks[id] -= taken;
      emit();
      return taken;
    },

    takeKey() {
      if (!keys.golden_key) return false;
      delete keys.golden_key;
      emit();
      return true;
    },

    takeTool(id) {
      if (id === 'hands' || !owned[id]) return false;
      delete owned[id];
      pruneBelt();
      if (active === id) active = 'hands';
      emit();
      return true;
    },

    setKey(value) {
      if (value) keys.golden_key = true;
      else delete keys.golden_key;
      emit();
    },

    hasKeyId(id) { return !!keys[id]; },

    get hasKey() { return !!keys.golden_key; },

    /** Deja la mochila vacía. Lo usa el self-test, antes de jugar. */
    reset() {
      clearAll();
      emit();
    },
  };
})();
