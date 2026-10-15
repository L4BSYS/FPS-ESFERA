// Red neuronal densa para criaturas: robots y bichos salvajes.
// Adaptada de la simulación de criaturas neurales (FPS/js/19-neuralnet.js):
// mismo forward tanh + clonado + crossover + mutación, pero con namespace
// window.Game, RNG inyectable (con semilla para mapas deterministas) y
// serialización para guardar cerebros.
//
// Revisión del original: usaba M.Utils (randGauss/pick/randInt) que no existe
// en ningún archivo (construir la red reventaba), Math.random sin semilla y
// sin forma de guardar. structuralMutate tenía una rama muerta (layer+1 < L
// siempre vale en ocultas): se simplificó.
(function () {
  window.Game = window.Game || {};

  function makeLocalUtils(rng) {
    const rand = (typeof rng === 'function') ? rng : Math.random;
    let spare = null;
    function randGauss() {
      // Box-Muller con el RNG dado (misma semilla = mismos cerebros).
      if (spare !== null) {
        const v = spare;
        spare = null;
        return v;
      }
      let u = 0;
      let v = 0;
      while (u === 0) u = rand();
      while (v === 0) v = rand();
      const mag = Math.sqrt(-2.0 * Math.log(u));
      spare = mag * Math.sin(2.0 * Math.PI * v);
      return mag * Math.cos(2.0 * Math.PI * v);
    }
    return {
      randGauss: randGauss,
      pick(list) { return list[Math.floor(rand() * list.length)]; },
      randInt(a, b) { return a + Math.floor(rand() * (b - a + 1)); },
      rand() { return rand(); },
    };
  }

  function NeuralNetwork(sizes, rng) {
    this.sizes = sizes.slice();
    this.U = makeLocalUtils(rng);
    this.weights = [];   // [capa][neurona_destino][neurona_origen]
    this.biases = [];    // [capa][neurona_destino]
    this.acts = [];      // activaciones de la última pasada (para debug)
    for (let l = 1; l < sizes.length; l++) {
      const W = [];
      const B = [];
      for (let to = 0; to < sizes[l]; to++) {
        const row = [];
        for (let from = 0; from < sizes[l - 1]; from++) row.push(this.U.randGauss() * 0.55);
        W.push(row);
        B.push(this.U.randGauss() * 0.30);
      }
      this.weights.push(W);
      this.biases.push(B);
    }
  }

  NeuralNetwork.prototype.reset = function () { this.acts = []; };

  NeuralNetwork.prototype.forward = function (inputs) {
    const clean = inputs.map((v) => (isFinite(v) ? v : 0));
    this.acts = [clean];
    for (let l = 0; l < this.weights.length; l++) {
      const prev = this.acts[l];
      const W = this.weights[l];
      const B = this.biases[l];
      const next = new Array(W.length);
      for (let to = 0; to < W.length; to++) {
        let sum = B[to];
        const row = W[to];
        const n = Math.min(row.length, prev.length);
        for (let from = 0; from < n; from++) sum += row[from] * prev[from];
        const a = Math.tanh(sum);
        next[to] = isFinite(a) ? a : 0;
      }
      this.acts.push(next);
    }
    return this.acts[this.acts.length - 1];
  };

  NeuralNetwork.prototype.clone = function () {
    const n = new NeuralNetwork(this.sizes);
    for (let l = 0; l < this.weights.length; l++) {
      n.weights[l] = this.weights[l].map((r) => r.slice());
      n.biases[l] = this.biases[l].slice();
    }
    return n;
  };

  /* Número total de neuronas ocultas+salidas (complejidad) */
  NeuralNetwork.prototype.complexity = function () {
    let s = 0;
    for (let l = 1; l < this.sizes.length; l++) s += this.sizes[l];
    return s;
  };

  /* cruce: si las arquitecturas coinciden, blend uniforme; si no, base del
     padre A y toma pesos de B cuando quepan */
  NeuralNetwork.crossover = function (a, b) {
    if (a.sizes.join(',') === b.sizes.join(',')) {
      const c = a.clone();
      for (let l = 0; l < c.weights.length; l++) {
        for (let to = 0; to < c.weights[l].length; to++) {
          for (let f = 0; f < c.weights[l][to].length; f++) {
            if (Math.random() < 0.5) c.weights[l][to][f] = b.weights[l][to][f];
          }
          if (Math.random() < 0.5) c.biases[l][to] = b.biases[l][to];
        }
      }
      return c;
    }
    // Arquitecturas distintas: hijo = clon de A con pesos de B por superposición
    const c = a.clone();
    for (let l = 0; l < c.weights.length; l++) {
      const bW = b.weights[l];
      const bB = b.biases[l];
      if (!bW) continue;
      for (let to = 0; to < c.weights[l].length; to++) {
        if (!bW[to]) continue;
        const rowB = bW[to];
        for (let f = 0; f < c.weights[l][to].length; f++) {
          if (rowB[f] !== undefined && Math.random() < 0.5) c.weights[l][to][f] = rowB[f];
        }
        if (bB[to] !== undefined && Math.random() < 0.5) c.biases[l][to] = bB[to];
      }
    }
    return c;
  };

  NeuralNetwork.prototype.mutate = function (rate, amount, rng) {
    const U = rng ? makeLocalUtils(rng) : this.U;
    for (let l = 0; l < this.weights.length; l++) {
      for (let to = 0; to < this.weights[l].length; to++) {
        const row = this.weights[l][to];
        for (let f = 0; f < row.length; f++) {
          if (U.rand() < rate) row[f] += U.randGauss() * amount;
          if (U.rand() < rate * 0.05) row[f] = U.randGauss() * 0.5 * Math.sign(row[f] || 1);
        }
        if (U.rand() < rate) this.biases[l][to] += U.randGauss() * amount;
      }
    }
  };

  /* Mutación estructural: añadir/quitar una neurona oculta respetando límites.
     stage = { hidden: { neurons: [min, max], min: <capas ocultas mínimas> } }.
     Orientación: weights[l] es [destinos de la capa l+1][orígenes de la capa l]. */
  NeuralNetwork.prototype.structuralMutate = function (stage) {
    const L = this.sizes.length;
    const hiddenIdx = [];
    for (let l = 1; l < L - 1; l++) hiddenIdx.push(l);
    if (!hiddenIdx.length) return false;

    const cfg = stage.hidden;
    const layer = this.U.pick(hiddenIdx);
    const countHere = this.sizes[layer];
    const minN = cfg.neurons[0];
    const maxN = cfg.neurons[1];

    if (Math.random() < 0.5 && countHere < maxN) {
      // añadir neurona en la capa `layer`: fila nueva (destino) + columna nueva (origen)
      this.sizes[layer]++;
      this.biases[layer - 1].push(this.U.randGauss() * 0.15);
      this.weights[layer - 1].push(new Array(this.sizes[layer - 1]).fill(0).map(() => this.U.randGauss() * 0.25));
      for (let to = 0; to < this.weights[layer].length; to++) {
        this.weights[layer][to].push(this.U.randGauss() * 0.25);
      }
      return true;
    } else if (countHere > minN) {
      // Quitar una neurona: basta con respetar el mínimo de neuronas (la
      // capa sigue existiendo). El original pedía además capas ocultas de
      // sobra, lo que bloqueaba achicar redes de una sola capa oculta.
      const idx = this.U.randInt(0, countHere - 1);
      this.sizes[layer]--;
      this.biases[layer - 1].splice(idx, 1);
      this.weights[layer - 1].splice(idx, 1); // eliminar fila (destino en `layer`)
      for (let to = 0; to < this.weights[layer].length; to++) {
        this.weights[layer][to].splice(idx, 1); // eliminar columna (origen en `layer`)
      }
      return true;
    }
    return false;
  };

  /* Guardado: plano y JSON-friendly, para persistir cerebros o mandar por red. */
  NeuralNetwork.prototype.toJSON = function () {
    return {
      sizes: this.sizes.slice(),
      weights: this.weights.map((layer) => layer.map((row) => row.slice())),
      biases: this.biases.map((b) => b.slice()),
    };
  };

  NeuralNetwork.fromJSON = function (data) {
    const n = new NeuralNetwork(data.sizes.slice());
    n.weights = data.weights.map((layer) => layer.map((row) => row.slice()));
    n.biases = data.biases.map((b) => b.slice());
    return n;
  };

  window.Game.NeuralNet = {
    NeuralNetwork: NeuralNetwork,
    fresh(sizes, rng) { return new NeuralNetwork(sizes, rng); },
  };
})();
