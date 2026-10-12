(function () {
  window.Game = window.Game || {};

  let audioCtx = null;
  let masterGain = null;
  let ambientGain = null;

  function audible() {
    if (!audioCtx) return false;
    const settings = window.Game.Settings;
    if (settings && settings.sfx === false) return false;
    return true;
  }

  function applyMusic() {
    if (!ambientGain) return;
    const settings = window.Game.Settings;
    const on = !settings || settings.music !== false;
    const vol = settings ? settings.musicVolume : 1;
    ambientGain.gain.value = on ? 0.05 * Math.max(0, Math.min(1, vol)) : 0;
  }

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.35;
    masterGain.connect(audioCtx.destination);
    startAmbient();
  }

  function createNoiseBuffer(duration) {
    const size = Math.floor(audioCtx.sampleRate * duration);
    const buffer = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function playShoot() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer(0.15);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3500, t0);
    filter.frequency.exponentialRampToValueAtTime(250, t0 + 0.15);
    const ng = audioCtx.createGain();
    ng.gain.setValueAtTime(0.55, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
    noise.connect(filter).connect(ng).connect(masterGain);
    noise.start(t0); noise.stop(t0 + 0.15);

    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, t0);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.1);
    const og = audioCtx.createGain();
    og.gain.setValueAtTime(0.5, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc.connect(og).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.12);
  }

  function playHit() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, t0);
    osc.frequency.exponentialRampToValueAtTime(200, t0 + 0.08);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.28, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.08);
  }

  function playKill() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    [0, 0.05].forEach((delay, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = i === 0 ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(500 - i * 150, t0 + delay);
      osc.frequency.exponentialRampToValueAtTime(70, t0 + delay + 0.25);
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.32, t0 + delay);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + delay + 0.25);
      osc.connect(g).connect(masterGain);
      osc.start(t0 + delay); osc.stop(t0 + delay + 0.25);
    });
  }

  function playFootstep() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(85 + Math.random() * 20, t0);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.13, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.09);
  }

  function playJump() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.08);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.1);
  }

  function playBreak(kind) {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const freq = kind === 'metal' ? 520 : (kind === 'stone' ? 140 : 210);
    const osc = audioCtx.createOscillator();
    osc.type = kind === 'metal' ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.4), t0 + 0.12);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(kind === 'stone' ? 0.28 : 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.14);
  }

  function playLand() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, t0);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.22, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.12);
  }

  function playDamage() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer(0.2);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 260;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    noise.connect(filter).connect(g).connect(masterGain);
    noise.start(t0); noise.stop(t0 + 0.2);
  }

  function playEnemyGrowl() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(75, t0);
    osc.frequency.linearRampToValueAtTime(42, t0 + 0.3);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.22, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.3);
  }

  function playHeartbeat() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    [0, 0.15].forEach(delay => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 55;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.32, t0 + delay);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + delay + 0.12);
      osc.connect(g).connect(masterGain);
      osc.start(t0 + delay); osc.stop(t0 + delay + 0.12);
    });
  }

  function playDoorSound() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer(0.5);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(300, t0);
    filter.frequency.linearRampToValueAtTime(700, t0 + 0.5);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.18, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    noise.connect(filter).connect(g).connect(masterGain);
    noise.start(t0); noise.stop(t0 + 0.5);
  }

  function playButtonSound() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, t0);
    osc.frequency.setValueAtTime(1800, t0 + 0.05);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.1);
  }

  function playElevatorSound() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, t0);
    osc.frequency.linearRampToValueAtTime(110, t0 + 0.4);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.14, t0);
    g.gain.linearRampToValueAtTime(0.08, t0 + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.6);
  }

  function playPickup(kind) {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const freqs = kind === 'armor' ? [440, 660, 880] : (kind === 'ammo' ? [300, 450, 600] : [523, 659, 784]);
    freqs.forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = audioCtx.createGain();
      const start = t0 + i * 0.06;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.22, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      osc.connect(g).connect(masterGain);
      osc.start(start); osc.stop(start + 0.18);
    });
  }

  function playReloadOut() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(300, t0);
    osc.frequency.exponentialRampToValueAtTime(150, t0 + 0.06);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.07);
  }

  function playReloadIn() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(400, t0 + 0.08);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.22, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.09);
  }

  function playPunch() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, t0);
    osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.08);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.22, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.09);
  }

  function playEmptyClick() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(500, t0);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
    osc.connect(g).connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.04);
  }

  function playVictoryFanfare() {
    if (!audible()) return;
    const t0 = audioCtx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = audioCtx.createGain();
      const start = t0 + i * 0.13;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.28, start + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
      osc.connect(g).connect(masterGain);
      osc.start(start); osc.stop(start + 0.4);
    });
  }

  function startAmbient() {
    ambientGain = audioCtx.createGain();
    ambientGain.connect(masterGain);
    applyMusic();

    [55, 82.5, 110].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = audioCtx.createGain();
      g.gain.value = i === 0 ? 1 : 0.35;
      osc.connect(g).connect(ambientGain);
      osc.start();

      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.02;
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 3;
      lfo.connect(lfoGain).connect(osc.detune);
      lfo.start();
    });
  }

  window.Game.Audio = {
    init: initAudio,
    isReady: () => !!audioCtx,
    applyMusic: applyMusic,
    shoot: playShoot,
    hit: playHit,
    kill: playKill,
    footstep: playFootstep,
    jump: playJump,
    breakBlock: playBreak,
    land: playLand,
    damage: playDamage,
    enemyGrowl: playEnemyGrowl,
    heartbeat: playHeartbeat,
    door: playDoorSound,
    button: playButtonSound,
    elevator: playElevatorSound,
    pickup: playPickup,
    reloadOut: playReloadOut,
    reloadIn: playReloadIn,
    emptyClick: playEmptyClick,
    punch: playPunch,
    victoryFanfare: playVictoryFanfare,
  };
})();
