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

  // Solo la antorcha vive en pilas. La comida y la toxina se consumen
  // al tocarlas (vos y los robots): no son inventario.
  const STACK_MAX = { torch: 6 };

  const resources = { wood: 0, stone: 0, metal: 0 };
  const stacks = { torch: 0 };
  const keys = {};
  const owned = { hands: true };
  let active = 'hands';
  const listeners = [];

  function snapshot() {
    return {
      resources: { wood: resources.wood, stone: resources.stone, metal: resources.metal },
      stacks: { torch: stacks.torch },
      active,
      hasKey: !!keys.golden_key,
      owned: Object.assign({}, owned),
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
    Object.keys(keys).forEach((id) => { delete keys[id]; });
    Object.keys(owned).forEach((id) => { delete owned[id]; });
    owned.hands = true;
    active = 'hands';
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

    /** Rueda y touchpad: salta a la siguiente herramienta que ya tenés. */
    cycleTool(dir) {
      const have = TOOLS.filter((entry) => owned[entry.id]);
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
