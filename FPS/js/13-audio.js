// js/13-audio.js (part 13/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
//Music and Sounds
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const soundGenerators = {}; // Procedural sound generators

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
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1200, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.1);
      gain.gain.setValueAtTime(0.7, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.1);
    };

    soundGenerators['footstep'] = () => {
      const bufferSize = 4096;
      const noise = audioContext.createScriptProcessor(bufferSize, 1, 1);
      noise.onaudioprocess = function(e) {
        const output = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          output[i] = (Math.random() * 2 - 1) * Math.exp(-3 * i / bufferSize);
        }
      };
      const gain = audioContext.createGain();
      gain.gain.value = 0.3;
      noise.connect(gain).connect(audioContext.destination);
      setTimeout(() => noise.disconnect(), 100); // short burst
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

    soundGenerators['harvest'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.setValueAtTime(400, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.2);
      gain.gain.setValueAtTime(0.2, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    };

    soundGenerators['hit'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, audioContext.currentTime);
      gain.gain.setValueAtTime(0.5, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.1);
    };

    soundGenerators['explosion'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(20, audioContext.currentTime + 0.5);
      gain.gain.setValueAtTime(0.6, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.5);
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
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, audioContext.currentTime);
      gain.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    };

    soundGenerators['block_break_stone'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(100, audioContext.currentTime);
      gain.gain.setValueAtTime(0.4, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.25);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.25);
    };

    soundGenerators['block_break_metal'] = () => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, audioContext.currentTime);
      gain.gain.setValueAtTime(0.5, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.3);
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
  function playSound(name) {
    if (!sfxEnabled) return;
    const generator = soundGenerators[name];
    if (generator) {
      generator();
    } else {
      console.warn(`No sound generator for: ${name}`);
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

