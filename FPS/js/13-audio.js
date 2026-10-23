// js/13-audio.js (part 13/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
//Music and Sounds
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const soundGenerators = {}; // Procedural sound generators

// === Audio helpers (procedural, no assets) ===
const _audioNoiseCache = {};
const _panCam = new THREE.Vector3();
const _panDelta = new THREE.Vector3();
const _panRight = new THREE.Vector3();
const _panQuat = new THREE.Quaternion();
const _atCam = new THREE.Vector3();

function getNoiseBuffer(seconds) {
  const key = String(seconds);
  if (_audioNoiseCache[key]) return _audioNoiseCache[key];
  const len = Math.max(1, Math.floor(audioContext.sampleRate * seconds));
  const buf = audioContext.createBuffer(1, len, audioContext.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  _audioNoiseCache[key] = buf;
  return buf;
}

function audioEnvelope(pan, initial) {
  const env = audioContext.createGain();
  env.gain.value = 0.0001;
  let out = audioContext.destination;
  if (pan && typeof audioContext.createStereoPanner === 'function') {
    const p = audioContext.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(out);
    out = p;
  }
  env.connect(out);
  return env;
}

function playTone(opts) {
  const o = opts || {};
  const now = audioContext.currentTime;
  const start = now + Math.max(0, o.delay || 0);
  const dur = o.duration || 0.15;
  const osc = audioContext.createOscillator();
  osc.type = o.type || 'sine';
  const f0 = Math.max(20, o.freq || 440);
  osc.frequency.setValueAtTime(f0, start);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), start + dur);
  const env = audioEnvelope(o.pan || 0);
  const peak = Math.max(0.0001, o.gain || 0.2);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + (o.attack || 0.005));
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

function playNoise(opts) {
  const o = opts || {};
  const now = audioContext.currentTime;
  const start = now + Math.max(0, o.delay || 0);
  const dur = o.duration || 0.12;
  const src = audioContext.createBufferSource();
  src.buffer = getNoiseBuffer(4);
  const filter = audioContext.createBiquadFilter();
  filter.type = o.filter || 'bandpass';
  filter.frequency.setValueAtTime(Math.max(30, o.freq || 1000), start);
  if (o.freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqEnd), start + dur);
  filter.Q.value = o.q || 1;
  const env = audioEnvelope(o.pan || 0);
  const peak = Math.max(0.0001, o.gain || 0.2);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + (o.attack || 0.004));
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter).connect(env);
  const offset = Math.random() * 3;
  src.start(start, offset, dur + 0.03);
  src.stop(start + dur + 0.05);
}

function worldPan(pos) {
  if (typeof camera === 'undefined' || !camera || !pos) return 0;
  try {
    camera.getWorldPosition(_panCam);
    camera.getWorldQuaternion(_panQuat);
    _panRight.set(1, 0, 0).applyQuaternion(_panQuat);
    _panDelta.set(pos.x - _panCam.x, 0, pos.z - _panCam.z);
    if (_panDelta.lengthSq() < 0.0001) return 0;
    _panDelta.normalize();
    return Math.max(-1, Math.min(1, _panDelta.dot(_panRight) * 1.1));
  } catch (e) {
    return 0;
  }
}

function playSoundAt(name, position, opts) {
  if (!position || typeof camera === 'undefined' || !camera) {
    playSound(name, opts);
    return;
  }
  try {
    camera.getWorldPosition(_atCam);
    const dist = _atCam.distanceTo(position);
    const maxDist = (opts && opts.maxDist) || 45;
    if (dist >= maxDist) return;
    const atten = Math.pow(1 - dist / maxDist, 1.7);
    const out = Object.assign({}, opts);
    out.pan = worldPan(position);
    out.gain = ((opts && opts.gain) || 1) * atten;
    playSound(name, out);
  } catch (e) {
    playSound(name, opts);
  }
}

function setSfxEnabled(on) {
  sfxEnabled = !!on;
  if (ambientBed) {
    const now = audioContext.currentTime;
    const g = ambientBed.gain.gain;
    g.cancelScheduledValues(now);
    g.linearRampToValueAtTime(sfxEnabled ? 0.03 : 0.0001, now + 0.4);
  }
  if (sfxEnabled && audioContext.state === 'suspended') {
    try { const r = audioContext.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
  }
}

let ambientBed = null;
let ambientCreakTimer = null;
function startAmbientBed() {
  if (ambientBed) return;
  try {
    const src = audioContext.createBufferSource();
    src.buffer = getNoiseBuffer(4);
    src.loop = true;
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 0.6;
    const lfo = audioContext.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = audioContext.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    const gain = audioContext.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter).connect(gain).connect(audioContext.destination);
    src.start();
    const now = audioContext.currentTime;
    gain.gain.linearRampToValueAtTime(sfxEnabled ? 0.03 : 0.0001, now + 3);
    ambientBed = { src: src, gain: gain, filter: filter };
    if (!ambientCreakTimer) {
      ambientCreakTimer = setInterval(function () {
        if (!sfxEnabled) return;
        if (typeof isGamePaused !== 'undefined' && isGamePaused) return;
        if (Math.random() < 0.65) {
          playSound('ambient_creak', { pan: Math.random() * 2 - 1, gain: 0.5 + Math.random() * 0.8 });
        }
      }, 16000);
    }
  } catch (e) {
    ambientBed = null;
  }
}

let heartbeatTimer = 0;
function updateHeartbeat(delta) {
  if (!player || player.health <= 0) { heartbeatTimer = 0; return; }
  const hp = player.health / (player.maxHealth || 100);
  if (hp > 0.35) { heartbeatTimer = 0; return; }
  heartbeatTimer -= delta;
  if (heartbeatTimer <= 0) {
    heartbeatTimer = 0.55 + hp * 1.1;
    playSound('heartbeat', { gain: 0.45 + (0.35 - hp) * 1.2 });
  }
}


// === Procedural Sounds ===
  function initSounds() {
    soundGenerators['jump'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(600, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.2);
      gain.gain.setValueAtTime(0.5, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    };

    soundGenerators['gunshot'] = () => {
      const p = 0.92 + Math.random() * 0.16;
      playNoise({ duration: 0.12, gain: 0.3, filter: 'highpass', freq: 900 * p, freqEnd: 300, q: 0.7 });
      playNoise({ duration: 0.2, gain: 0.18, filter: 'lowpass', freq: 500 * p, freqEnd: 120, q: 0.8 });
      playTone({ freq: 180 * p, freqEnd: 55, duration: 0.14, type: 'triangle', gain: 0.22 });
    };

    soundGenerators['footstep'] = (opts) => {
      const o = opts || {};
      const g = (o.gain || 1) * (o.sprint ? 1.15 : 0.8);
      const surface = o.surface || 'dirt';
      const pan = (Math.random() - 0.5) * 0.18;
      playTone({ freq: 92 + Math.random() * 16, freqEnd: 46, duration: 0.09, type: 'sine', gain: 0.14 * g, pan: pan });
      if (surface === 'metal') {
        playNoise({ duration: 0.09, gain: 0.12 * g, filter: 'bandpass', freq: 1800, freqEnd: 1100, q: 3, pan: pan });
        playTone({ freq: 1300, freqEnd: 900, duration: 0.14, type: 'sine', gain: 0.035 * g });
      } else if (surface === 'wood') {
        playNoise({ duration: 0.08, gain: 0.12 * g, filter: 'bandpass', freq: 700, freqEnd: 350, q: 1.4, pan: pan });
      } else if (surface === 'stone') {
        playNoise({ duration: 0.07, gain: 0.13 * g, filter: 'highpass', freq: 1200, freqEnd: 700, q: 0.8, pan: pan });
      } else {
        playNoise({ duration: 0.1, gain: 0.09 * g, filter: 'lowpass', freq: 600, freqEnd: 180, q: 0.7, pan: pan });
      }
    };

    soundGenerators['land'] = (opts) => {
      const g = (opts && opts.gain) || 1;
      playTone({ freq: 130, freqEnd: 40, duration: 0.16, type: 'sine', gain: 0.3 * g });
      playNoise({ duration: 0.18, gain: 0.2 * g, filter: 'lowpass', freq: 600, freqEnd: 100, q: 0.8 });
    };

    soundGenerators['enemy_shot'] = (opts) => {
      const o = opts || {};
      const g = o.gain || 0.8;
      playTone({ freq: 620, freqEnd: 140, duration: 0.16, type: 'square', gain: 0.12 * g, pan: o.pan || 0 });
      playNoise({ duration: 0.08, gain: 0.08 * g, filter: 'highpass', freq: 1600, freqEnd: 500, pan: o.pan || 0 });
    };

    soundGenerators['bullet_whiz'] = (opts) => {
      const o = opts || {};
      const g = o.gain || 0.6;
      playNoise({ duration: 0.16, gain: 0.28 * g, filter: 'bandpass', freq: 4600, freqEnd: 700, q: 7, pan: o.pan || 0 });
      playNoise({ duration: 0.1, gain: 0.16 * g, filter: 'highpass', freq: 2200, freqEnd: 900, q: 2, pan: o.pan || 0 });
      playTone({ freq: 1800, freqEnd: 700, duration: 0.1, type: 'sine', gain: 0.04 * g, pan: o.pan || 0 });
    };

    soundGenerators['impact_wood'] = (opts) => {
      const g = (opts && opts.gain) || 1;
      playNoise({ duration: 0.09, gain: 0.18 * g, filter: 'bandpass', freq: 900, freqEnd: 400, q: 1.5 });
      playTone({ freq: 180, freqEnd: 90, duration: 0.08, type: 'triangle', gain: 0.12 * g });
    };

    soundGenerators['impact_stone'] = (opts) => {
      const g = (opts && opts.gain) || 1;
      playNoise({ duration: 0.08, gain: 0.2 * g, filter: 'highpass', freq: 1200, freqEnd: 600, q: 0.8 });
      playTone({ freq: 300, freqEnd: 150, duration: 0.07, type: 'square', gain: 0.06 * g });
    };

    soundGenerators['impact_metal'] = (opts) => {
      const g = (opts && opts.gain) || 1;
      const f = 1200 + Math.random() * 500;
      playTone({ freq: f, freqEnd: f * 0.92, duration: 0.3, type: 'sine', gain: 0.07 * g });
      playTone({ freq: f * 2, freqEnd: f * 1.8, duration: 0.18, type: 'sine', gain: 0.03 * g });
      playNoise({ duration: 0.06, gain: 0.1 * g, filter: 'highpass', freq: 2000, freqEnd: 1200 });
    };

    soundGenerators['flesh_hit'] = (opts) => {
      const g = (opts && opts.gain) || 1;
      playTone({ freq: 110, freqEnd: 45, duration: 0.14, type: 'sine', gain: 0.22 * g });
      playNoise({ duration: 0.12, gain: 0.12 * g, filter: 'lowpass', freq: 600, freqEnd: 150, q: 0.8 });
    };

    soundGenerators['heartbeat'] = (opts) => {
      const g = (opts && opts.gain) || 1;
      const now = audioContext.currentTime;
      const beat = (t, amp) => {
        const osc = audioContext.createOscillator();
        const env = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(58, t);
        osc.frequency.exponentialRampToValueAtTime(34, t + 0.14);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(amp, t + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        osc.connect(env).connect(audioContext.destination);
        osc.start(t);
        osc.stop(t + 0.18);
      };
      beat(now, 0.2 * g);
      beat(now + 0.2, 0.14 * g);
    };

    soundGenerators['ambient_creak'] = (opts) => {
      const o = opts || {};
      const g = o.gain || 1;
      playNoise({ duration: 0.9, gain: 0.02 * g, filter: 'bandpass', freq: 180 + Math.random() * 120, freqEnd: 90, q: 9, pan: o.pan || 0 });
      playTone({ freq: 110 + Math.random() * 40, freqEnd: 70, duration: 1.1, type: 'sine', gain: 0.014 * g, pan: o.pan || 0 });
    };

    soundGenerators['robot_servo'] = (opts) => {
      const o = opts || {};
      const g = o.gain || 0.5;
      const pan = o.pan || 0;
      const f = 70 + Math.random() * 35;
      playTone({ freq: f, freqEnd: f * 1.4, duration: 0.26, type: 'sawtooth', gain: 0.035 * g, pan: pan });
      playTone({ freq: 540 + Math.random() * 180, freqEnd: 380, duration: 0.18, type: 'sine', gain: 0.028 * g, pan: pan, delay: 0.03 });
      playNoise({ duration: 0.1, gain: 0.035 * g, filter: 'bandpass', freq: 1500, freqEnd: 700, q: 4, pan: pan, delay: 0.02 });
      if (o.alert) {
        playTone({ freq: 1200, freqEnd: 1000, duration: 0.07, type: 'square', gain: 0.03 * g, pan: pan, delay: 0.2 });
        playTone({ freq: 1200, freqEnd: 1000, duration: 0.07, type: 'square', gain: 0.03 * g, pan: pan, delay: 0.3 });
      }
    };

    soundGenerators['fauna_chirp'] = (opts) => {
      const o = opts || {};
      const g = o.gain || 0.5;
      const pan = o.pan || 0;
      const pitch = o.pitch || 1;
      const base = (o.alert ? 1450 : 950) * pitch * (0.92 + Math.random() * 0.16);
      const notes = o.alert ? 3 : 2;
      for (let i = 0; i < notes; i++) {
        const jitter = (Math.random() - 0.5) * 0.12;
        playTone({
          freq: base * (1 + i * 0.14),
          freqEnd: base * (1.45 + i * 0.16),
          duration: o.alert ? 0.055 : 0.07,
          type: 'sine',
          gain: (o.alert ? 0.07 : 0.055) * g,
          pan: pan + jitter,
          delay: i * (o.alert ? 0.075 : 0.09)
        });
      }
      playNoise({ duration: 0.035, gain: 0.025 * g, filter: 'highpass', freq: 2400, freqEnd: 1200, pan: pan, delay: 0.01 });
    };

    // === New Simple Effects ===
    soundGenerators['health-regen'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(400, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.3);
      gain.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.3);
    };

    soundGenerators['damage-taken'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(100, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.2);
      gain.gain.setValueAtTime(0.4, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    };

    soundGenerators['door_open'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.setValueAtTime(300, audioContext.currentTime);
      gain.gain.setValueAtTime(0.2, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    };

    soundGenerators['door_locked'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, audioContext.currentTime);
      gain.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.4);
    };

    soundGenerators['door_close'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.setValueAtTime(250, audioContext.currentTime);
      gain.gain.setValueAtTime(0.2, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    };

    soundGenerators['key-pickup'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.setValueAtTime(800, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1600, audioContext.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    };

    soundGenerators['ammo-pickup'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.setValueAtTime(500, audioContext.currentTime);
      gain.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    };

    soundGenerators['pickup'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.setValueAtTime(600, audioContext.currentTime);
      gain.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    };

    soundGenerators['harvest'] = (opts) => {
      const o = opts || {};
      const surface = o.surface || 'wood';
      const g = o.gain || 1;
      if (surface === 'metal') {
        playTone({ freq: 900, freqEnd: 620, duration: 0.22, type: 'sine', gain: 0.1 * g });
        playNoise({ duration: 0.09, gain: 0.12 * g, filter: 'highpass', freq: 1800, freqEnd: 900 });
      } else if (surface === 'stone') {
        playNoise({ duration: 0.12, gain: 0.16 * g, filter: 'bandpass', freq: 1100, freqEnd: 400, q: 1.2 });
        playTone({ freq: 170, freqEnd: 90, duration: 0.1, type: 'triangle', gain: 0.1 * g });
      } else {
        playNoise({ duration: 0.14, gain: 0.15 * g, filter: 'lowpass', freq: 800, freqEnd: 220, q: 0.8 });
        playTone({ freq: 210, freqEnd: 110, duration: 0.11, type: 'triangle', gain: 0.1 * g });
      }
    };

    soundGenerators['hit'] = () => {
      playTone({ freq: 150, freqEnd: 60, duration: 0.12, type: 'sine', gain: 0.24 });
      playNoise({ duration: 0.1, gain: 0.14, filter: 'lowpass', freq: 900, freqEnd: 250, q: 0.8 });
    };

    soundGenerators['explosion'] = (opts) => {
      const g = (opts && opts.gain) || 1;
      playNoise({ duration: 0.5, gain: 0.35 * g, filter: 'lowpass', freq: 800, freqEnd: 60, q: 0.8 });
      playNoise({ duration: 0.15, gain: 0.25 * g, filter: 'highpass', freq: 1200, freqEnd: 300, q: 0.6 });
      playTone({ freq: 90, freqEnd: 28, duration: 0.55, type: 'sine', gain: 0.35 * g });
    };

    soundGenerators['ui_click'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, audioContext.currentTime);
      gain.gain.setValueAtTime(0.2, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.1);
    };

    soundGenerators['block_break_wood'] = () => {
      playNoise({ duration: 0.14, gain: 0.18, filter: 'lowpass', freq: 1100, freqEnd: 260, q: 0.8 });
      playTone({ freq: 220, freqEnd: 90, duration: 0.12, type: 'triangle', gain: 0.12 });
    };

    soundGenerators['block_break_stone'] = () => {
      playNoise({ duration: 0.12, gain: 0.2, filter: 'bandpass', freq: 1600, freqEnd: 450, q: 1.1 });
      playTone({ freq: 150, freqEnd: 70, duration: 0.1, type: 'square', gain: 0.08 });
    };

    soundGenerators['block_break_metal'] = () => {
      playTone({ freq: 1400, freqEnd: 1150, duration: 0.28, type: 'sine', gain: 0.08 });
      playTone({ freq: 2600, freqEnd: 2200, duration: 0.18, type: 'sine', gain: 0.035 });
      playNoise({ duration: 0.08, gain: 0.1, filter: 'highpass', freq: 2200, freqEnd: 1200 });
    };

    soundGenerators['weapon_empty'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(80, audioContext.currentTime);
      gain.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    };
  }

  // === Play Sound ===
  function playSound(name, opts) {
    if (!sfxEnabled) return;
    const generator = soundGenerators[name];
    if (!generator) {
      console.warn(`No sound generator for: ${name}`);
      return;
    }
    try {
      if (audioContext.state === 'suspended') {
        const r = audioContext.resume();
        if (r && r.catch) r.catch(() => {});
      }
      generator(opts || {});
    } catch (e) {
      console.warn(`Sound failed: ${name}`, e);
    }
  }

  // === Ambient Music ===
  let musicInterval;
  let musicVolume = 1.0;
  let musicEnabled = true;
  let sfxEnabled = true;
  function setMusicEnabled(on) {
    musicEnabled = !!on;
    if (musicEnabled) startAmbientMusic();
    else stopAmbientMusic();
  }
  function startAmbientMusic() {
    if (musicInterval) return; // Already playing

    const baseNote = 220; // Base frequency (A)
    const intervals = [0, 5, 7, 12]; // A, C#, E, A (nice stable)
    let step = 0;

    const playDroplet = () => {
      if (!musicEnabled || musicVolume <= 0) { step++; return; }
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';

      const note = baseNote * Math.pow(2, intervals[step % intervals.length] / 12); // Step through predictable notes
      osc.frequency.setValueAtTime(note, audioContext.currentTime);
      gain.gain.setValueAtTime(0.005 * musicVolume, audioContext.currentTime); // MUCH softer
      gain.gain.linearRampToValueAtTime(0.0005, audioContext.currentTime + 1); // Fade slowly even lower
      
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 2); // Lasts 2 seconds
      
      step++; // Next note in sequence
    };

    musicInterval = setInterval(playDroplet, 7000); // Slower: every 4 seconds
  }

  function stopAmbientMusic() {
    if (musicInterval) {
      clearInterval(musicInterval);
      musicInterval = null;
    }
  }

