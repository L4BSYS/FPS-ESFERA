(function () {
  window.Game = window.Game || {};

  let hp = 100;
  const maxHp = 100;
  let dead = false;
  const listeners = [];

  window.Game.PlayerHealth = {
    get hp() { return hp; },
    get maxHp() { return maxHp; },
    get isDead() { return dead; },

    damage(amount) {
      if (dead) return;
      hp = Math.max(0, hp - amount);
      if (window.Game.Audio) window.Game.Audio.damage();
      if (hp <= 0) dead = true;
      listeners.forEach((fn) => fn(hp, maxHp, dead));
    },

    heal(amount) {
      if (dead) return;
      hp = Math.min(maxHp, hp + amount);
      listeners.forEach((fn) => fn(hp, maxHp, dead));
    },

    onChange(fn) {
      listeners.push(fn);
    },

    revive() {
      hp = maxHp;
      dead = false;
      listeners.forEach((fn) => fn(hp, maxHp, dead));
    },

    reset() {
      hp = maxHp;
      dead = false;
    },
  };
})();
