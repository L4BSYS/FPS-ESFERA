class NeuralNetwork {
    /**
     * Creates an instance of NeuralNetwork.
     * @param {number} inputSize - Number of input neurons.
     * @param {number[]} [hiddenLayers=[2]] - Array of sizes for each hidden layer. Max 3 layers, min 2 neurons per layer enforced initially.
     * @param {number} [outputSize=2] - Number of output neurons.
     * @param {boolean} [neutralInit=false] - Initialize weights near zero.
     * @param {object} [options={}] - Additional options.
     * @param {number} [options.connectionDensity=1.0] - Initial connection density (1.0 = fully connected). Not fully implemented during initial build, use adjustConnectionDensity later.
     * @param {number[]} [options.specialNeuronProbs] - Probabilities for neuron types [memory, regulator, pattern, modulator, noise]. Defaults provided if undefined.
     */
    constructor(inputSize, hiddenLayers = [2], outputSize = 2, neutralInit = false, options = {}) {
        if (inputSize <= 0) throw new Error("Input size must be positive.");
        if (outputSize < 0) throw new Error("Output size cannot be negative."); // Allow 0 output for specific cases?

        this.inputSize = inputSize;
        // Keep hidden layer config flexible, validation happens during initialization
        this.hiddenLayersConfig = hiddenLayers.map(l => Math.max(1, l)); // Allow 1 neuron per layer
        this.outputSize = outputSize;
        this.neutralInit = neutralInit;

        // Neuron Type configuration
        this.specialNeuronProbs = options.specialNeuronProbs || [0.05, 0.05, 0.05, 0.05, 0.05]; // memory, regulator, pattern, modulator, noise
        this.neuronTypes = ['memory', 'regulator', 'pattern', 'modulator', 'noise', 'standard']; // Keep 'standard' last

        // Core network structure: Nested arrays for neurons, list of matrices for weights
        this.neurons = []; // Will be [[layer0_neurons], [layer1_neurons], ..., [output_layer_neurons]]
        this.weights = []; // Will be [weights_0_1, weights_1_2, ..., weights_lastHidden_output]

        // Initialize network structure
        this.initializeNetwork();

        // Additional features
        this.neuronActivations = null; // Stores activations from the last 'activate' call
        this.memory = {}; // Global memory store (consider neuron-local memory instead/as well)
        this.activationHistory = []; // For temporal patterns / stability checks
        this.globalModulators = { // Neuromodulators
            dopamine: 0.5,
            serotonin: 0.5,
            acetylcholine: 0.5
        };

        // For consumable temporary effects in the creatures brain
        this.invertOutputs = false;

        // Optional: Apply initial connection density if provided differently from 1.0
        if (options.connectionDensity && options.connectionDensity < 1.0) {
             this.adjustConnectionDensity(options.connectionDensity, true); // Force apply during init
        }

        //console.log(`NN Initialized: ${this.getLayerSizes().join('-')}`);
    }

    // --- Initialization ---

    initializeNetwork() {
        this.initializeAllNeurons(this.neutralInit);
        this.initializeAllWeights(this.neutralInit);
        this.assignNeuronRoles(); // Assign icons etc. after creation
    }

    /** Calculates the sizes of all layers including input and output */
    getLayerSizes() {
        return [this.inputSize, ...this.hiddenLayersConfig, ...(this.outputSize > 0 ? [this.outputSize] : [])];
    }

    /** Initializes the this.neurons nested array */
    initializeAllNeurons(neutralInit = false) {
        this.neurons = [];
        const layerSizes = this.getLayerSizes();

        layerSizes.forEach((size, layerIndex) => {
            const layerNeurons = [];
            for (let i = 0; i < size; i++) {
                let type = 'standard'; // Default
                if (layerIndex === 0) {
                    type = 'input';
                } else if (this.outputSize > 0 && layerIndex === layerSizes.length - 1) {
                    type = 'output'; // Changed from 'decision' for clarity, behavior controlled in activation
                } else if (layerIndex > 0) { // Hidden layers
                    type = this.getRandomNeuronType();
                }
                layerNeurons.push(this.createNeuron(layerIndex, i, type, neutralInit));
            }
            this.neurons.push(layerNeurons);
        });
    }

    /** Initializes the this.weights array */
    initializeAllWeights(neutralInit = false) {
        this.weights = [];
        const layerSizes = this.getLayerSizes();
        // Create weight matrices between consecutive layers
        for (let i = 0; i < layerSizes.length - 1; i++) {
            const rows = layerSizes[i + 1]; // Neurons in the next layer
            const cols = layerSizes[i];     // Neurons in the current layer
            this.weights.push(this.randomMatrix(rows, cols, neutralInit));
        }
    }

    getRandomNeuronType() {
        let rand = Math.random();
        let cumulativeProb = 0;
        for(let i = 0; i < this.specialNeuronProbs.length; i++) {
            cumulativeProb += this.specialNeuronProbs[i];
            if (rand < cumulativeProb) {
                return this.neuronTypes[i];
            }
        }
        return 'standard'; // Default if no special type hit
    }


    /** Creates a single neuron object with necessary properties. */
    createNeuron(layer, index, type = 'standard', neutralInit = false) {
        const neuron = {
            id: `${layer}-${index}`, // Keep ID for potential external reference/debugging
            type: type,
            layer: layer,
            index: index, // Index within the layer
            bias: neutralInit ? 0 : (Math.random() * 0.4 - 0.2), // Smaller initial bias range
            activation: 0,
            // Placeholders for potential role info
            icon: '❓',
            title: 'Neuron',
            description: 'Basic unit'
        };

        // Type-specific properties
        switch (type) {
            case 'input':
                neuron.bias = 0; // Inputs typically don't have bias
                break;
            case 'memory':
                neuron.memoryWeight = Math.random() * 0.5 + 0.5; // 0.5 to 1.0
                neuron.state = 0;
                break;
            case 'regulator':
                neuron.targetActivation = 0.5;
                neuron.influence = Math.random() * 0.1 + 0.05; // 0.05 to 0.15
                break;
            case 'pattern':
                // Determine previous layer size robustly
                const prevLayerSize = layer === 1 ? this.inputSize : (this.neurons[layer - 1]?.length || 0);
                neuron.template = Array(prevLayerSize).fill(0).map(() => Math.random() * 2 - 1);
                neuron.sensitivity = Math.random() * 0.4 + 0.6; // 0.6 to 1.0
                break;
            case 'modulator':
                neuron.modulatorType = ['dopamine', 'serotonin', 'acetylcholine'][Math.floor(Math.random() * 3)];
                neuron.effect = Math.random() * 0.4 + 0.1; // 0.1 to 0.5
                break;
            case 'noise':
                neuron.amplitude = Math.random() * 0.1 + 0.05; // 0.05 to 0.15
                neuron.rate = Math.random() * 0.1 + 0.01; // 0.01 to 0.11
                break;
            case 'output': // Changed from 'decision'
                 neuron.threshold = Math.random() * 0.2 + 0.6; // Example: 0.6 to 0.8 threshold for action
                 // neuron.options = ['action1', 'action2'].slice(0, this.outputSize); // Example metadata
                 break;
             // 'standard' needs no extra properties initially
        }
        return neuron;
    }

    assignNeuronRoles() {
        const roles = {
            'input': { icon: '📥', title: 'Input', description: 'Receives external signals' },
            'output': { icon: '📤', title: 'Output', description: 'Produces network result' },
            'memory': { icon: '🧠', title: 'Memory', description: 'Maintains internal state' },
            'regulator': { icon: '⚖️', title: 'Regulator', description: 'Stabilizes layer activity' },
            'pattern': { icon: '🔍', title: 'Pattern', description: 'Detects specific inputs' },
            'modulator': { icon: '🧪', title: 'Modulator', description: 'Adjusts global state' },
            'noise': { icon: '🎲', title: 'Noise', description: 'Introduces randomness' },
            'standard': { icon: '⚡', title: 'Standard', description: 'Basic processing unit' },
            // 'social': {icon: '👥', title: 'Social Neuron', description: 'Processes social inputs'} // Example if needed
        };

        this.neurons.flat().forEach(neuron => {
            const role = roles[neuron.type] || roles['standard'];
            neuron.icon = role.icon;
            neuron.title = role.title;
            neuron.description = role.description;
        });
    }

    // --- Activation ---

    /**
     * Processes inputs through the network.
     * @param {number[]} inputs - Input values. Length should match inputSize.
     * @returns {number[]} Activations of the output layer.
     */
    activate(inputs) {
        if (!Array.isArray(inputs)) {
             console.error("Activate Error: Inputs must be an array.", inputs);
             // Return zeros or throw error based on desired behavior
             return this.outputSize > 0 ? new Array(this.outputSize).fill(0) : [];
        }

        // Pad or truncate inputs to match inputSize
        const currentInputs = new Array(this.inputSize);
        for (let i = 0; i < this.inputSize; i++) {
             currentInputs[i] = i < inputs.length ? inputs[i] : 0;
        }

        if (!this.neurons || this.neurons.length === 0 || !this.neurons[0]) {
            console.error("Activate Error: Network not properly initialized (neurons missing).");
            return this.outputSize > 0 ? new Array(this.outputSize).fill(0) : [];
        }

        // 1. Set Input Layer Activations
        this.neurons[0].forEach((neuron, i) => {
            // Allow special input processing if needed, e.g., for 'social' type
            if (neuron.type === 'social' && neuron.familiarityThreshold !== undefined) {
                 neuron.activation = currentInputs[i] > neuron.familiarityThreshold ? 1 : 0;
            } else {
                 neuron.activation = currentInputs[i];
            }
        });
        let previousLayerActivations = this.neurons[0].map(n => n.activation);
        this.neuronActivations = [previousLayerActivations.slice()]; // Store history

        // 2. Process Hidden and Output Layers
        for (let layerIndex = 1; layerIndex < this.neurons.length; layerIndex++) {
            const currentLayerNeurons = this.neurons[layerIndex];
            const layerWeights = this.weights[layerIndex - 1]; // Weights FROM previous layer TO current layer

            if (!layerWeights || layerWeights.length !== currentLayerNeurons.length || (layerWeights[0] && layerWeights[0].length !== previousLayerActivations.length)) {
                 console.error(`Activate Error: Weight matrix dimension mismatch at layer ${layerIndex}.`,
                               `Expected ${currentLayerNeurons.length}x${previousLayerActivations.length}, got`, layerWeights);
                 // Attempt to return something reasonable
                 const dummyActivations = new Array(currentLayerNeurons.length).fill(0);
                 this.neuronActivations.push(dummyActivations);
                 previousLayerActivations = dummyActivations;
                 continue; // Skip processing this layer if weights are wrong
            }


            const currentLayerActivations = new Array(currentLayerNeurons.length);

            for (let neuronIndex = 0; neuronIndex < currentLayerNeurons.length; neuronIndex++) {
                const neuron = currentLayerNeurons[neuronIndex];
                const neuronWeights = layerWeights[neuronIndex]; // Weights specific to this neuron

                // Calculate weighted sum efficiently
                let weightedSum = 0;
                for (let i = 0; i < previousLayerActivations.length; i++) {
                    weightedSum += previousLayerActivations[i] * neuronWeights[i];
                }
                weightedSum += neuron.bias;

                // Apply neuron-specific activation logic
                let activation;
                switch (neuron.type) {
                    case 'memory':
                        activation = this.processMemoryNeuron(neuron, weightedSum, previousLayerActivations, neuronWeights);
                        break;
                    case 'regulator':
                         // Pass necessary context if regulator needs it (e.g., current layer activations)
                         // For simplicity here, let's assume it mainly uses its own activation
                        activation = this.processRegulatorNeuron(neuron, weightedSum, currentLayerActivations); // Might need adjustment
                        break;
                    case 'pattern':
                        activation = this.processPatternNeuron(neuron, previousLayerActivations);
                        break;
                    case 'modulator':
                        activation = this.processModulatorNeuron(neuron, weightedSum);
                        break;
                    case 'noise':
                        activation = this.processNoiseNeuron(neuron, weightedSum); // Pass sum for potential modulation
                        break;
                    case 'output': // Was 'decision'
                        activation = this.processOutputNeuron(neuron, weightedSum); // Apply threshold etc.
                        break;
                    case 'standard':
                    case 'input': // Should not happen here, but default case
                    default:
                        activation = this.sigmoid(weightedSum);
                }

                // Apply global modulation (example: Dopamine affects learning rate/plasticity, Serotonin stability)
                // This could influence bias or activation thresholds, simplified here:
                activation *= (1 + (this.globalModulators.dopamine - 0.5) * 0.1); // Small dopamine effect example

                if (this.invertOutputs) { activation = 1 - activation; }

                neuron.activation = activation;
                currentLayerActivations[neuronIndex] = activation;
            }

            this.neuronActivations.push(currentLayerActivations.slice());
            previousLayerActivations = currentLayerActivations;
        }

        // 3. Post-activation updates
        this.updateMemory(); // Update global memory based on final activations
        this.updateModulators(); // Decay modulators towards baseline

        return previousLayerActivations; // Return the activations of the last layer processed

    }

    // --- Specialized Neuron Processors (Simplified Examples) ---
    // Note: previousLayerActivations and neuronWeights might be needed for some types

        processMemoryNeuron(neuron, weightedSum, previousLayerActivations, neuronWeights) {
            const currentInputActivation = this.sigmoid(weightedSum); // Process input normally first
            // Update internal state based on current input and previous state
            neuron.state = (neuron.memoryWeight * neuron.state) +
                           ((1 - neuron.memoryWeight) * currentInputActivation);
            return neuron.state; // Output the internal state
        }

        processRegulatorNeuron(neuron, weightedSum, currentLayerActivations) {
             // Regulator might adjust its bias or influence others based on layer activity
             // This is complex; simple example: activate normally, adjust bias slowly
             const activation = this.sigmoid(weightedSum);
             // Example: Slowly adjust bias if activation deviates from target
             // This might be better done in a separate 'learning' or 'regulation' step
             // const layerAvg = currentLayerActivations.reduce((a, b) => a + b, 0) / (currentLayerActivations.length || 1);
             // neuron.bias -= neuron.influence * (activation - neuron.targetActivation) * 0.01; // Slow adjustment
             return activation;
        }

        processPatternNeuron(neuron, previousLayerActivations) {
            if (!neuron.template || neuron.template.length !== previousLayerActivations.length) {
               // Handle mismatch: Reinitialize template or return 0
               console.warn(`Pattern neuron ${neuron.id} template size mismatch. Reinitializing.`);
               neuron.template = Array(previousLayerActivations.length).fill(0).map(() => Math.random() * 2 - 1);
               return 0;
            }
            const similarity = this.cosineSimilarity(previousLayerActivations, neuron.template);
            // Activate based on similarity exceeding a threshold (implicit in sensitivity)
            return Math.max(0, similarity * neuron.sensitivity); // Only positive response
        }

        processModulatorNeuron(neuron, weightedSum) {
            const activation = this.sigmoid(weightedSum);
            // Update global modulator levels based on this neuron's activation
            const currentLevel = this.globalModulators[neuron.modulatorType];
            const delta = (activation - 0.5) * neuron.effect * 0.1; // Influence change based on activation deviation from 0.5
            this.globalModulators[neuron.modulatorType] = Math.max(0, Math.min(1, currentLevel + delta));
            return activation; // Neuron's own activation
        }

        processNoiseNeuron(neuron, weightedSum) {
            const baseActivation = this.sigmoid(weightedSum); // Calculate base activation
            let noise = 0;
            if (Math.random() < neuron.rate) {
                noise = (Math.random() * 2 - 1) * neuron.amplitude;
            }
            // Combine base activation with noise, ensuring it stays within bounds [0, 1] typically
            return Math.max(0, Math.min(1, baseActivation + noise));
        }

        processOutputNeuron(neuron, weightedSum) {
             // Example: Simple sigmoid activation, could add thresholding if needed
             const activation = this.sigmoid(weightedSum);
             // Optional: Apply threshold for decision making
             // return activation >= neuron.threshold ? activation : 0;
             return activation;
        }

    // --- Helper Methods ---

    sigmoid(x) {
        // Consider using Math.tanh for [-1, 1] range or other functions
        return 1 / (1 + Math.exp(-x));
    }

    randomMatrix(rows, cols, neutralInit = false) {
        const matrix = [];
        for (let i = 0; i < rows; i++) {
            const row = [];
            for (let j = 0; j < cols; j++) {
                row.push(neutralInit ? (Math.random() * 0.2 - 0.1) : (Math.random() * 2 - 1));
            }
            matrix.push(row);
        }
        return matrix;
    }

    cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
        let dotProduct = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;
        for (let i = 0; i < vecA.length; i++) {
            const a = vecA[i] || 0; // Handle potential undefined/NaN
            const b = vecB[i] || 0;
            dotProduct += a * b;
            magnitudeA += a * a;
            magnitudeB += b * b;
        }
        magnitudeA = Math.sqrt(magnitudeA);
        magnitudeB = Math.sqrt(magnitudeB);
        if (magnitudeA === 0 || magnitudeB === 0) return 0;
        return dotProduct / (magnitudeA * magnitudeB);
    }

    updateMemory() {
         // Example: Simple global memory update
        this.neurons.flat().forEach(neuron => {
            if (neuron.type === 'memory' || Math.abs(neuron.activation) > 0.8) { // Store strong activations too
                this.memory[neuron.id] = neuron.activation;
            }
        });
        // Decay old memories
        Object.keys(this.memory).forEach(key => {
            this.memory[key] *= 0.95; // Decay factor
            if (Math.abs(this.memory[key]) < 0.01) delete this.memory[key];
        });
    }

    updateModulators() {
        // Natural decay toward baseline (e.g., 0.5)
        Object.keys(this.globalModulators).forEach(key => {
            this.globalModulators[key] = this.globalModulators[key] * 0.98 + 0.5 * 0.02; // Slower decay
        });
    }


    // --- Cloning, Crossover, Mutation ---

    clone() {
        // Create a new instance with the same configuration parameters
        const clone = new NeuralNetwork(
            this.inputSize,
            this.hiddenLayersConfig.slice(), // Copy array
            this.outputSize,
            this.neutralInit, // neutralInit likely doesn't matter much post-training
             { specialNeuronProbs: this.specialNeuronProbs.slice() } // Copy probs
        );

        // Deep copy weights - critical
        clone.weights = JSON.parse(JSON.stringify(this.weights));

        // Deep copy neurons - critical for types and biases
        // Re-create neurons using the stored config to maintain methods/prototype chain if needed
        // Or deep copy if neurons are simple data objects
         clone.neurons = JSON.parse(JSON.stringify(this.neurons));
         clone.assignNeuronRoles(); // Re-assign icons etc.

        // Copy other relevant state
        clone.memory = JSON.parse(JSON.stringify(this.memory));
        clone.globalModulators = { ...this.globalModulators };
        // clone.activationHistory = []; // Don't usually clone activation history

        return clone;
    }

    crossover(otherNetwork, rate = 0.5) {
        // Assumes basic structural compatibility (input/output size).
        // More complex crossover needed if hidden layers differ significantly.
        const child = this.clone(); // Start with a clone of parent 1

        // 1. Crossover Weights (simplest: layer-wise or element-wise coin flip)
        child.weights.forEach((layerWeights, layerIndex) => {
            if (layerIndex < otherNetwork.weights.length) {
                const otherLayerWeights = otherNetwork.weights[layerIndex];
                layerWeights.forEach((neuronWeights, neuronIndex) => {
                    if (neuronIndex < otherLayerWeights.length) {
                        const otherNeuronWeights = otherLayerWeights[neuronIndex];
                         neuronWeights.forEach((weight, weightIndex) => {
                            if (weightIndex < otherNeuronWeights.length) {
                                if (Math.random() < rate) {
                                     child.weights[layerIndex][neuronIndex][weightIndex] = otherNeuronWeights[weightIndex];
                                }
                            }
                         });
                    }
                });
            }
        });

        // 2. Crossover Neurons (Bias, Type-Specific Params)
         child.neurons.forEach((layerNeurons, layerIndex) => {
             if(layerIndex < otherNetwork.neurons.length) { // Check layer exists in other parent
                 const otherLayerNeurons = otherNetwork.neurons[layerIndex];
                 layerNeurons.forEach((neuron, neuronIndex) => {
                     if (neuronIndex < otherLayerNeurons.length) { // Check neuron exists
                         const otherNeuron = otherLayerNeurons[neuronIndex];
                         // Crossover bias
                         if (Math.random() < rate) {
                             neuron.bias = otherNeuron.bias;
                         }
                         // Crossover type-specific params (only if types match, or could introduce errors)
                         if (neuron.type === otherNeuron.type) {
                             switch(neuron.type) {
                                 case 'memory': if(Math.random() < rate) neuron.memoryWeight = otherNeuron.memoryWeight; break;
                                 case 'regulator':
                                     if(Math.random() < rate) neuron.targetActivation = otherNeuron.targetActivation;
                                     if(Math.random() < rate) neuron.influence = otherNeuron.influence;
                                     break;
                                 case 'pattern':
                                     if(Math.random() < rate) neuron.template = JSON.parse(JSON.stringify(otherNeuron.template));
                                     if(Math.random() < rate) neuron.sensitivity = otherNeuron.sensitivity;
                                     break;
                                 case 'modulator':
                                      if(Math.random() < rate) neuron.modulatorType = otherNeuron.modulatorType;
                                      if(Math.random() < rate) neuron.effect = otherNeuron.effect;
                                      break;
                                 case 'noise':
                                      if(Math.random() < rate) neuron.amplitude = otherNeuron.amplitude;
                                      if(Math.random() < rate) neuron.rate = otherNeuron.rate;
                                      break;
                                 case 'output':
                                      if(Math.random() < rate) neuron.threshold = otherNeuron.threshold;
                                      break;
                             }
                         } else {
                             // Optional: Chance to adopt the other neuron's type entirely
                             if (Math.random() < rate * 0.1) { // Low chance to switch type
                                  const newNeuronData = JSON.parse(JSON.stringify(otherNeuron));
                                  // Keep essential IDs the same
                                  newNeuronData.id = neuron.id;
                                  newNeuronData.layer = neuron.layer;
                                  newNeuronData.index = neuron.index;
                                  // Replace neuron - careful, might need re-assigning roles
                                  child.neurons[layerIndex][neuronIndex] = newNeuronData;
                             }
                         }
                     }
                 });
             }
         });
        child.assignNeuronRoles(); // Update roles after potential type changes


        // 3. Crossover Global Modulators (Average?)
        Object.keys(child.globalModulators).forEach(key => {
            if (otherNetwork.globalModulators[key] !== undefined) {
                child.globalModulators[key] = (child.globalModulators[key] + otherNetwork.globalModulators[key]) / 2;
            }
        });

        return child;
    }

     /**
      * Applies mutations to the network structure and parameters.
      * @param {number} mutationRate - Base probability for different mutation types.
      */
    mutate(mutationRate) {
         // 1. Mutate Weights and Biases
         this.neurons.flat().forEach(neuron => {
             // Mutate bias
             if (Math.random() < mutationRate) {
                 neuron.bias += (Math.random() * 0.4 - 0.2); // Gaussian-like addition could be better
             }
             // Mutate type-specific parameters
             this.mutateNeuronParams(neuron, mutationRate * 0.5); // Lower rate for params
         });

         this.weights.forEach(layerWeights => {
             layerWeights.forEach(neuronWeights => {
                 neuronWeights.forEach((weight, index) => {
                     if (Math.random() < mutationRate) {
                         // Add random value, scale by weight magnitude?
                         neuronWeights[index] += (Math.random() * 0.4 - 0.2);
                     }
                     // Chance to prune (set to 0) or strengthen connection
                     if (Math.random() < mutationRate * 0.1) {
                         neuronWeights[index] *= (Math.random() * 1.5 + 0.5); // Scale by 0.5 to 2.0
                     }
                      if (Math.random() < mutationRate * 0.05) { // Small chance to prune
                          neuronWeights[index] = 0;
                      }
                 });
             });
         });

         // 2. Structural Mutations (Lower Probability)
         const structuralMutationProb = mutationRate * 0.15; // slightly higher rate favors lineages diverging

         // --- Add/Remove Neuron ---
         // ONLY in HIDDEN layers
         if (this.hiddenLayersConfig.length > 0 && Math.random() < structuralMutationProb) {
             const layerIndex = Math.floor(Math.random() * this.hiddenLayersConfig.length); // 0 to numHiddenLayers-1
             if (Math.random() < 0.7) { // 70% chance to add
                 this.addNeuron(layerIndex + 1); // Add to hidden layer (layer index 1 onwards)
             } else if (this.hiddenLayersConfig[layerIndex] > 1) { // 30% chance to remove (if > 1 neuron)
                 this.removeNeuron(layerIndex + 1);
             }
         }

         // --- Add/Remove Hidden Layer ---
         // ONLY if hidden layers exist or are being added
if (Math.random() < structuralMutationProb * 0.5) { // Even lower probability
             const numHidden = this.hiddenLayersConfig.length;
              if (Math.random() < 0.6 && numHidden < 5) { // 60% chance to add (limit layers)
                  const position = Math.floor(Math.random() * (numHidden + 1)); // 0 to numHidden (inclusive)
                  const newLayerSize = Math.max(2, Math.floor(Math.random() * 5) + 2); // Random size 2-6
                  this.addHiddenLayer(position, newLayerSize);
              } else if (numHidden > 0) { // 40% chance to remove (if any exist)
                  const position = Math.floor(Math.random() * numHidden); // 0 to numHidden-1
                  this.removeHiddenLayer(position);
              }
         }

         // --- Add/Remove OUTPUT Neuron (lineage specialization) ---
         // Lineages can gain extra behavioral outputs (pheromone, vision, heal)
         // or shed them. Minimum 4 core outputs preserved (MoveX/Y/Throttle/Momentum).
         if (Math.random() < structuralMutationProb * 0.5) {
             if (this.outputSize < 10 && Math.random() < 0.6) {
                 this.addOutputNeuron();
             } else if (this.outputSize > 4) {
                 this.removeOutputNeuron();
             }
         }

        // --- Mutate Neuron Type ---
        // ONLY in HIDDEN layers
         if (this.hiddenLayersConfig.length > 0 && Math.random() < mutationRate * 0.2) {
            const layerIndex = Math.floor(Math.random() * this.hiddenLayersConfig.length) + 1; // 1 to numHiddenLayers
            const neuronIndex = Math.floor(Math.random() * this.neurons[layerIndex].length);
            const neuron = this.neurons[layerIndex][neuronIndex];
            const oldType = neuron.type;
            const possibleTypes = this.neuronTypes.filter(t => t !== 'input' && t !== 'output'); // Only mutate to hidden types
            const newType = possibleTypes[Math.floor(Math.random() * possibleTypes.length)];

            if (newType !== oldType) {
                 // Create a new neuron of the target type, keeping essential info
                 const newNeuron = this.createNeuron(neuron.layer, neuron.index, newType, this.neutralInit);
                 // Overwrite the old neuron in the structure
                 this.neurons[layerIndex][neuronIndex] = newNeuron;
                 this.assignNeuronRoles(); // Update roles
                 console.log(`Mutated neuron ${neuron.id} from ${oldType} to ${newType}`);
            }
         }


        // --- Mutate Connection Density --- (Optional)
        if (Math.random() < mutationRate * 0.05) {
             const currentDensity = this.calculateConnectionDensity();
             this.adjustConnectionDensity(currentDensity + (Math.random() * 0.2 - 0.1));
        }

         // Ensure consistency after structural changes (less critical if add/remove are robust)
        //this.validateAndUpdateStructure(); // Add a check if needed
    }


    mutateNeuronParams(neuron, rate) {
         // Mutate parameters specific to neuron types
         switch(neuron.type) {
             case 'memory':
                 if (Math.random() < rate) neuron.memoryWeight = Math.max(0, Math.min(1, neuron.memoryWeight + (Math.random() - 0.5) * 0.1));
                 break;
             case 'regulator':
                 if (Math.random() < rate) neuron.targetActivation = Math.max(0, Math.min(1, neuron.targetActivation + (Math.random() - 0.5) * 0.1));
                 if (Math.random() < rate) neuron.influence = Math.max(0.01, Math.min(0.5, neuron.influence + (Math.random() - 0.5) * 0.05));
                 break;
             case 'pattern':
                 if (neuron.template && Math.random() < rate) {
                     const index = Math.floor(Math.random() * neuron.template.length);
                     neuron.template[index] += (Math.random() - 0.5) * 0.2; // Mutate template element
                     // Normalize template? Optional.
                 }
                 if (Math.random() < rate) neuron.sensitivity = Math.max(0.1, Math.min(1.5, neuron.sensitivity + (Math.random() - 0.5) * 0.05));
                 break;
             case 'modulator':
                 if (Math.random() < rate) neuron.effect = Math.max(0, Math.min(1, neuron.effect + (Math.random() - 0.5) * 0.05));
                  // Maybe mutate modulatorType? Low probability
                  if(Math.random() < rate * 0.1) {
                       neuron.modulatorType = ['dopamine','serotonin','acetylcholine'][Math.floor(Math.random()*3)];
                  }
                 break;
             case 'noise':
                 if (Math.random() < rate) neuron.amplitude = Math.max(0, Math.min(0.5, neuron.amplitude + (Math.random() - 0.5) * 0.05));
                 if (Math.random() < rate) neuron.rate = Math.max(0.01, Math.min(0.5, neuron.rate + (Math.random() - 0.5) * 0.02));
                 break;
             case 'output': // Was 'decision'
                 if (neuron.threshold !== undefined && Math.random() < rate) neuron.threshold = Math.max(0, Math.min(1, neuron.threshold + (Math.random() - 0.5) * 0.05));
                 break;
         }
    }


    // --- Brain Flexibility (Incremental Adjustments) ---

    /** Expands or contracts the input layer */
    resizeInputs(newSize) {
        if (newSize === this.inputSize || newSize <= 0) return;
        //console.log(`Resizing inputs from ${this.inputSize} to ${newSize}`);

        const diff = newSize - this.inputSize;
        const oldSize = this.inputSize;
        this.inputSize = newSize;

        // Adjust Neurons in Layer 0
        if (diff > 0) { // Expand
            for (let i = 0; i < diff; i++) {
                const neuronIndex = oldSize + i;
                this.neurons[0].push(this.createNeuron(0, neuronIndex, 'input', this.neutralInit));
            }
        } else { // Contract
            this.neurons[0].splice(newSize); // Remove from end
        }
        // Re-index neurons in layer 0
        this.neurons[0].forEach((n, i) => { n.index = i; n.id = `0-${i}`; });

        // Adjust Weights FROM input layer TO first hidden layer (weights[0])
        if (this.weights.length > 0) {
            const firstHiddenLayerSize = this.neurons[1]?.length || 0;
            if (firstHiddenLayerSize > 0) {
                const oldWeights = this.weights[0];
                const newWeightMatrix = [];
                 for (let i = 0; i < firstHiddenLayerSize; i++) { // Each neuron in first hidden layer
                     const oldNeuronWeights = oldWeights[i] || [];
                     const newNeuronWeights = new Array(newSize);
                     for (let j = 0; j < newSize; j++) {
                         if (j < oldSize) {
                             newNeuronWeights[j] = oldNeuronWeights[j]; // Copy existing
                         } else {
                             newNeuronWeights[j] = this.neutralInit ? 0 : (Math.random() * 0.2 - 0.1); // Initialize new weights small
                         }
                     }
                     newWeightMatrix.push(newNeuronWeights);
                 }
                 this.weights[0] = newWeightMatrix;
            }
        }
        this.assignNeuronRoles(); // Update roles if needed
    }


    /** Adds a neuron to a specified HIDDEN layer */
    addNeuron(layerIndex) {
        // Ensure it's a hidden layer (index 1 to numHiddenLayers)
        if (layerIndex <= 0 || layerIndex > this.hiddenLayersConfig.length) {
            console.error(`Cannot add neuron to non-hidden layer index ${layerIndex}.`);
            return;
        }

        const layerSize = this.neurons[layerIndex].length;
        const neuronIndex = layerSize; // New neuron goes at the end
        console.log(`Adding neuron ${layerIndex}-${neuronIndex}`);

        // 1. Update Config
        this.hiddenLayersConfig[layerIndex - 1]++;

        // 2. Create and Add Neuron
        const type = this.getRandomNeuronType(); // Add a random type
        const newNeuron = this.createNeuron(layerIndex, neuronIndex, type, this.neutralInit);
        this.neurons[layerIndex].push(newNeuron);
        this.assignNeuronRoles(); // Update visuals

        // 3. Adjust Weights INTO the new neuron (new row in weights[layerIndex-1])
        const prevLayerSize = this.neurons[layerIndex - 1].length;
        const newIncomingWeights = this.randomMatrix(1, prevLayerSize, this.neutralInit)[0]; // Get a single row
        if(this.weights[layerIndex-1]) {
             this.weights[layerIndex - 1].push(newIncomingWeights);
        } else {
             console.error(`Weight matrix weights[${layerIndex-1}] missing during addNeuron.`);
             // Attempt recovery? Rebuild might be necessary here.
        }


        // 4. Adjust Weights FROM the new neuron (new column in weights[layerIndex])
        if (layerIndex < this.weights.length) { // Check if there's a next layer
            const nextLayerSize = this.neurons[layerIndex + 1]?.length || 0;
             if(nextLayerSize > 0) {
                 const weightsToNextLayer = this.weights[layerIndex];
                 for (let i = 0; i < nextLayerSize; i++) { // Add one weight to each neuron in the next layer
                     weightsToNextLayer[i].push(this.neutralInit ? 0 : (Math.random() * 0.2 - 0.1)); // Init small
                 }
             }
        }
         // Optional: Check consistency
         // this.validateAndUpdateStructure();
    }

    /** Removes the last neuron from a specified HIDDEN layer */
    removeNeuron(layerIndex) {
        // Ensure it's a hidden layer and has more than 1 neuron
        if (layerIndex <= 0 || layerIndex > this.hiddenLayersConfig.length) {
            console.error(`Cannot remove neuron from non-hidden layer index ${layerIndex}.`);
            return;
        }
        if (this.neurons[layerIndex].length <= 1) {
            console.warn(`Cannot remove last neuron from layer ${layerIndex}.`);
            return;
        }

        const neuronIndexToRemove = this.neurons[layerIndex].length - 1; // Remove last one
        const neuronId = `${layerIndex}-${neuronIndexToRemove}`;
        console.log(`Removing neuron ${neuronId}`);

        // 1. Update Config
        this.hiddenLayersConfig[layerIndex - 1]--;

        // 2. Remove Neuron
        this.neurons[layerIndex].pop();

        // 3. Remove Weights INTO the removed neuron (last row from weights[layerIndex-1])
        if(this.weights[layerIndex-1]) {
             this.weights[layerIndex - 1].pop();
        } else {
             console.error(`Weight matrix weights[${layerIndex-1}] missing during removeNeuron.`);
        }


        // 4. Remove Weights FROM the removed neuron (last column from weights[layerIndex])
        if (layerIndex < this.weights.length) { // Check if there's a next layer
            const nextLayerSize = this.neurons[layerIndex + 1]?.length || 0;
             if(nextLayerSize > 0) {
                 const weightsToNextLayer = this.weights[layerIndex];
                 for (let i = 0; i < nextLayerSize; i++) {
                     weightsToNextLayer[i].pop(); // Remove last weight entry
                 }
             }
        }
// Optional: Check consistency
         // this.validateAndUpdateStructure();
     }


     /** Adds a new output neuron (extra behavioral output: e.g. pheromone, vision, heal). */
     addOutputNeuron() {
         const outputLayerIndex = this.neurons.length - 1;
         if (outputLayerIndex < 1) return; // need at least input + something
         const neuronIndex = this.neurons[outputLayerIndex].length;
         const newNeuron = this.createNeuron(outputLayerIndex, neuronIndex, 'output', this.neutralInit);
         this.neurons[outputLayerIndex].push(newNeuron);
         this.outputSize++;

         // Weights INTO the new output neuron from the previous layer
         const prevLayerSize = this.neurons[outputLayerIndex - 1].length;
         if (this.weights[outputLayerIndex - 1]) {
             this.weights[outputLayerIndex - 1].push(
                 this.randomMatrix(1, prevLayerSize, this.neutralInit)[0]
             );
         }
         this.assignNeuronRoles();
     }

     /** Removes the last output neuron, keeping at least 4 core outputs. */
     removeOutputNeuron() {
         if (this.outputSize <= 4) return;
         const outputLayerIndex = this.neurons.length - 1;
         this.outputSize--;
         this.neurons[outputLayerIndex].pop();
         if (this.weights[outputLayerIndex - 1]) {
             this.weights[outputLayerIndex - 1].pop();
         }
         this.assignNeuronRoles();
     }


     /** Adds a new hidden layer */
    addHiddenLayer(position, size) {
         // Position is relative to hidden layers (0 = before first hidden, hiddenLayers.length = after last hidden)
        position = Math.max(0, Math.min(position, this.hiddenLayersConfig.length));
        size = Math.max(1, size); // Ensure at least one neuron

        const actualLayerIndex = position + 1; // Index in the full neurons/weights arrays
        console.log(`Adding hidden layer of size ${size} at position ${position} (actual index ${actualLayerIndex})`);

        // 1. Update Config
        this.hiddenLayersConfig.splice(position, 0, size);

        // 2. Create Neurons for New Layer
        const newLayerNeurons = [];
        for (let i = 0; i < size; i++) {
            newLayerNeurons.push(this.createNeuron(actualLayerIndex, i, this.getRandomNeuronType(), this.neutralInit));
        }
        this.neurons.splice(actualLayerIndex, 0, newLayerNeurons);
        this.updateNeuronIndicesAndIds(); // Renumber subsequent layers

        // 3. Adjust Weights
        const prevLayerSize = this.neurons[actualLayerIndex - 1].length;
        const nextLayerSize = this.neurons[actualLayerIndex + 1]?.length || 0; // Size of layer *after* the new one

        // Create weights FROM previous layer TO new layer
        const weightsToNewLayer = this.randomMatrix(size, prevLayerSize, this.neutralInit);

        // Create weights FROM new layer TO next layer
        let weightsFromNewLayer = null;
        if (nextLayerSize > 0) {
            weightsFromNewLayer = this.randomMatrix(nextLayerSize, size, this.neutralInit);
        }

        // Insert/Replace weights
        if (weightsFromNewLayer) {
             // Replace the original weights matrix (that spanned the gap) with the two new ones
            this.weights.splice(position, 1, weightsToNewLayer, weightsFromNewLayer);
        } else {
            // Adding layer at the end, just insert weights to it
            this.weights.splice(position, 0, weightsToNewLayer);
        }

         this.assignNeuronRoles();
         // this.validateAndUpdateStructure();
    }

    /** Removes a hidden layer */
    removeHiddenLayer(position) {
        // Position is relative to hidden layers (0 to numHiddenLayers - 1)
        if (position < 0 || position >= this.hiddenLayersConfig.length) {
            console.error(`Invalid hidden layer position ${position} to remove.`);
            return;
        }

        const actualLayerIndex = position + 1; // Index in the full neurons/weights arrays
        console.log(`Removing hidden layer at position ${position} (actual index ${actualLayerIndex})`);

        // 1. Update Config
        this.hiddenLayersConfig.splice(position, 1);

        // 2. Remove Neurons
        this.neurons.splice(actualLayerIndex, 1);
        this.updateNeuronIndicesAndIds(); // Renumber subsequent layers

        // 3. Adjust Weights
        const prevLayerSize = this.neurons[actualLayerIndex - 1].length; // Layer before removed one
        const nextLayerSize = this.neurons[actualLayerIndex]?.length || 0; // Layer after removed one (now at actualLayerIndex)

        // Create new weights connecting prevLayer to nextLayer
        let newConnectingWeights = null;
        if (nextLayerSize > 0) {
             newConnectingWeights = this.randomMatrix(nextLayerSize, prevLayerSize, this.neutralInit);
             // Remove the two weight matrices associated with the removed layer, replace with the new one
             this.weights.splice(position, 2, newConnectingWeights);
        } else {
             // Removing the last hidden layer, just remove the weights leading into it
             this.weights.splice(position, 1);
        }


         this.assignNeuronRoles();
         // this.validateAndUpdateStructure();
    }

    /** Updates layer/index properties and IDs after structural changes */
    updateNeuronIndicesAndIds() {
        this.neurons.forEach((layerNeurons, layerIndex) => {
            layerNeurons.forEach((neuron, neuronIndex) => {
                neuron.layer = layerIndex;
                neuron.index = neuronIndex;
                neuron.id = `${layerIndex}-${neuronIndex}`;
            });
        });
    }


    // --- Validation and Auto-Regulation ---

    /** Checks if the weights dimensions match the neuron layer dimensions. */
    validateStructure() {
        const layerSizes = this.getLayerSizes();
        if (this.neurons.length !== layerSizes.length) {
             console.error(`Neuron layer count mismatch. Expected ${layerSizes.length}, found ${this.neurons.length}`);
             return false;
        }
        for(let i = 0; i < layerSizes.length; i++) {
             if (this.neurons[i].length !== layerSizes[i]) {
                 console.error(`Neuron count mismatch in layer ${i}. Expected ${layerSizes[i]}, found ${this.neurons[i].length}`);
                 return false;
             }
        }

        if (this.weights.length !== layerSizes.length - 1) {
            console.error(`Weight matrix count mismatch. Expected ${layerSizes.length - 1}, found ${this.weights.length}`);
            return false;
        }

        for(let i = 0; i < this.weights.length; i++) {
             const expectedRows = layerSizes[i+1]; // Neurons in next layer
             const expectedCols = layerSizes[i]; // Neurons in current layer
             if (!this.weights[i] || this.weights[i].length !== expectedRows) {
                 console.error(`Weight matrix ${i} row count mismatch. Expected ${expectedRows}, found ${this.weights[i]?.length}`);
                 return false;
             }
             if (!this.weights[i][0] || this.weights[i][0].length !== expectedCols) {
                 console.error(`Weight matrix ${i} column count mismatch. Expected ${expectedCols}, found ${this.weights[i][0]?.length}`);
                 return false;
             }
        }
        return true;
    }

    /** Attempts to rebuild weights/neurons if validation fails. *Caution: Destructive.* */
    validateAndUpdateStructure() {
        if (!this.validateStructure()) {
            console.warn("Network structure validation failed. Attempting to rebuild based on config.");
            try {
                this.initializeNetwork(); // Rebuild everything - might lose learning!
                console.log("Network structure rebuilt.");
                return true;
            } catch (e) {
                console.error("Failed to rebuild network structure:", e);
                return false;
            }
        }
        return true;
    }


     /** Adjusts connection density by pruning (setting weights to 0) or potentially adding */
    adjustConnectionDensity(newDensity, force = false) {
        newDensity = Math.max(0.05, Math.min(1.0, newDensity)); // Clamp density
        // console.log(`Adjusting connection density towards ${newDensity.toFixed(2)}`);

        this.weights.forEach((layerWeights) => {
            layerWeights.forEach((neuronWeights) => {
                neuronWeights.forEach((weight, index) => {
                    // Pruning: If random number > density, set weight to 0
                    if (Math.random() > newDensity) {
                         if(force || Math.abs(weight) > 0.01) { // Only prune non-zero weights unless forced
                             neuronWeights[index] = 0;
                         }
                    }
                    // Optional: Un-pruning (low probability if density increases)
                     else if (weight === 0 && Math.random() < (newDensity - 0.5) * 0.01) { // Small chance to restore connection if density > 0.5
                         neuronWeights[index] = (Math.random() * 0.2 - 0.1); // Small random weight
                    }
                });
            });
        });
         // Note: This simple method doesn't guarantee the *exact* density percentage.
    }

    calculateConnectionDensity() {
         let totalWeights = 0;
         let nonZeroWeights = 0;
         this.weights.flat(2).forEach(w => {
             totalWeights++;
             if (Math.abs(w) > 1e-6) { // Count non-negligible weights
                 nonZeroWeights++;
             }
         });
         return totalWeights > 0 ? nonZeroWeights / totalWeights : 0;
    }

    /**
     * Re-establishes a connection between two neurons.
     * Only adjacent layers are supported in this dense matrix architecture;
     * non-adjacent pairs are ignored gracefully instead of crashing.
     */
    formNewConnection(fromNeuron, toNeuron) {
        if (!fromNeuron || !toNeuron) return false;
        if (fromNeuron.layer >= toNeuron.layer) return false; // Feedforward only
        if (toNeuron.layer !== fromNeuron.layer + 1) {
            console.warn(`formNewConnection: skip connection (L${fromNeuron.layer}→L${toNeuron.layer}) no soportada en arquitectura densa.`);
            return false;
        }

        const weightMatrix = this.weights[fromNeuron.layer];
        if (!weightMatrix || !weightMatrix[toNeuron.index]) return false;

        // Revive the connection with a small random weight (previously pruned to 0)
        if (Math.abs(weightMatrix[toNeuron.index][fromNeuron.index]) <= 1e-6) {
            weightMatrix[toNeuron.index][fromNeuron.index] = (Math.random() * 0.4 - 0.2);
        }
        return true;
    }

    autoRegulate() {
        // Example simple regulation: Adjust density based on average activation
        const avgActivation = this.neurons.flat()
                               .reduce((sum, n) => sum + Math.abs(n.activation), 0) / (this.neurons.flat().length || 1);

        this.activationHistory.push(avgActivation);
        if (this.activationHistory.length > 50) this.activationHistory.shift();

        // Simple stability check (variance)
        const mean = this.activationHistory.reduce((a, b) => a + b, 0) / this.activationHistory.length;
        const variance = this.activationHistory.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / this.activationHistory.length;
        const stdDev = Math.sqrt(variance);

        const targetDensity = this.calculateConnectionDensity();
        let densityAdjustment = 0;

        // If activity is too low and unstable, slightly increase density
        if (mean < 0.2 && stdDev > 0.1 && Math.random() < 0.02) {
            densityAdjustment = 0.02;
        }
        // If activity is too high and stable, slightly decrease density
        else if (mean > 0.7 && stdDev < 0.05 && Math.random() < 0.02) {
            densityAdjustment = -0.02;
        }

        if (densityAdjustment !== 0) {
             this.adjustConnectionDensity(targetDensity + densityAdjustment);
        }

        // Maybe add/remove a neuron very occasionally based on performance/stability?
        // Requires an external fitness measure.
        // if (performanceIsStagnant && Math.random() < 0.005) {
        //     if(Math.random() < 0.5) this.addNeuron( /* random hidden layer */);
        //     else this.removeNeuron( /* random hidden layer */);
        // }
    }


    // --- Export / Import ---

     /**
      * Serializes the network state to JSON.
      * @returns {string} JSON representation of the network.
      */
     toJSON() {
         return JSON.stringify({
             inputSize: this.inputSize,
             hiddenLayersConfig: this.hiddenLayersConfig,
             outputSize: this.outputSize,
             neutralInit: this.neutralInit, // Store original setting
             specialNeuronProbs: this.specialNeuronProbs,
             // Core state
             weights: this.weights,
             neurons: this.neurons, // Neuron state includes bias, type, special params
             // Other state
             globalModulators: this.globalModulators,
             memory: this.memory,
             // Note: activationHistory is usually not serialized
         });
     }

     /**
      * Creates a NeuralNetwork instance from JSON data.
      * @param {string|object} jsonData - JSON string or pre-parsed object.
      * @returns {NeuralNetwork} A new network instance.
      */
     static fromJSON(jsonData) {
         const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

         // Validate essential data
         if (!data || typeof data.inputSize !== 'number' || !Array.isArray(data.hiddenLayersConfig) || typeof data.outputSize !== 'number') {
             throw new Error("Invalid JSON data for NeuralNetwork: Missing core configuration.");
         }

         // Create instance with basic config
         const net = new NeuralNetwork(
             data.inputSize,
             data.hiddenLayersConfig,
             data.outputSize,
             data.neutralInit || false,
             { specialNeuronProbs: data.specialNeuronProbs }
         );

         // Restore Core State - Perform checks
         if (!Array.isArray(data.weights) || !Array.isArray(data.neurons)) {
              throw new Error("Invalid JSON data: Missing weights or neurons arrays.");
         }
          // Simple dimension check before assigning
          const expectedLayerSizes = [data.inputSize, ...data.hiddenLayersConfig, ...(data.outputSize > 0 ? [data.outputSize] : [])];
          if (data.neurons.length !== expectedLayerSizes.length || data.weights.length !== expectedLayerSizes.length - 1) {
              console.warn("JSON data structure mismatch with config. Network might behave unexpectedly.");
               // Option 1: Throw error (safer)
               // throw new Error("JSON data structure (neurons/weights) does not match configuration (input/hidden/output sizes).");
               // Option 2: Try to load anyway (might crash later)
               console.error("Loading potentially incompatible structure. Validation recommended.");
          }


         net.weights = data.weights; // Assume structure is correct based on warning above
         net.neurons = data.neurons;

         // Restore Other State
         net.globalModulators = data.globalModulators || { dopamine: 0.5, serotonin: 0.5, acetylcholine: 0.5 };
         net.memory = data.memory || {};

         // Post-load setup
         net.assignNeuronRoles(); // Ensure icons etc. are set

          // Final validation check (optional but recommended)
          if (!net.validateStructure()) {
              console.error("Loaded network failed structural validation!");
              // Decide whether to throw an error or allow the potentially broken network
          }


         return net;
     }
}

// -- VisualizationdrawNetwork(brain, creature) 
function drawNetwork(brain, creature) {
    const containerId = "#networkVisualization"; // ID of the container div
    const tooltipClassName = "network-tooltip"; // CSS class for the tooltip

    // --- Initial Checks & Setup ---
    d3.select(containerId).html(""); // Clear previous visualization
    if (!brain || !(brain instanceof NeuralNetwork) || !creature /* || !creature.isAlive */ ) {
        // Optionally display a message if no brain/creature
        // d3.select(containerId).text("No network data available.");
        return;
    }

    const width = 300, height = 300; // SVG dimensions
    const svg = d3.select(containerId).append("svg")
        .attr("width", "100%") // Make responsive
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`) // Use viewBox for scaling
        .style("display", "block"); // Prevent extra space below SVG

    // Add zoom/pan group
    const g = svg.append("g");
    svg.call(d3.zoom().scaleExtent([0.5, 5]).on("zoom", e => g.attr("transform", e.transform)));

    const nodePositions = {}; // Store calculated { x, y, neuron, activation, ... } for each node ID

    // --- Step 1: Calculate Node Positions ---
    const layerSizes = brain.getLayerSizes(); // [inputSize, h1Size, ..., outputSize]
    const layerCount = layerSizes.length;
    if (layerCount === 0 || brain.neurons.length !== layerCount) {
        console.error("drawNetwork: Mismatch between getLayerSizes and brain.neurons structure.");
        return; // Cannot draw if structure is inconsistent
    }

    const layerSpacing = width / (layerCount || 1); // Avoid division by zero if layerCount is 0

    brain.neurons.forEach((layerNeurons, layerIndex) => {
        const numNeuronsInLayer = layerNeurons.length;
        if (numNeuronsInLayer === 0) return; // Skip empty layers (shouldn't happen with valid NN)

        const xPos = layerSpacing / 2 + layerIndex * layerSpacing; // Center layers better
        const ySpacing = height / (numNeuronsInLayer + 1);

        layerNeurons.forEach((neuron, neuronIndex) => {
            // Use neuron.id as the key, assuming it's correctly `${layerIndex}-${neuronIndex}`
            nodePositions[neuron.id] = {
                x: xPos,
                y: ySpacing * (neuronIndex + 1),
                neuron: neuron, // Store the neuron object itself
                activation: neuron.activation || 0, // Initial activation state
                // Get sensor role using neuron.index for input layer
                roleSensor: layerIndex === 0 ? (creature.sensorRoles?.[neuron.index] || '') : '',
                connected: false // Will be updated when drawing connections
            };
        });
    });

    // --- Step 2: Prepare Connection Data & Update Node 'connected' Status ---
    const allConnections = [];
    brain.weights.forEach((layerWeightMatrix, fromLayerIndex) => {
        // fromLayerIndex is the index of the matrix, corresponding to the *source* layer
        if (!Array.isArray(layerWeightMatrix)) return; // Robustness check

        layerWeightMatrix.forEach((neuronWeightsToTarget, targetNeuronIndex) => {
            if (!Array.isArray(neuronWeightsToTarget)) return; // Robustness check

            const toLayerIndex = fromLayerIndex + 1;
            const targetNeuronId = `${toLayerIndex}-${targetNeuronIndex}`;

            neuronWeightsToTarget.forEach((weight, sourceNeuronIndex) => {
                const sourceNeuronId = `${fromLayerIndex}-${sourceNeuronIndex}`;

                // Only include connections with non-negligible weight AND valid nodes
                if (Math.abs(weight) > 1e-9 && nodePositions[sourceNeuronId] && nodePositions[targetNeuronId]) {
                    allConnections.push({
                        from: sourceNeuronId,
                        to: targetNeuronId,
                        weight: weight
                    });
                    // Mark nodes as connected
                    nodePositions[sourceNeuronId].connected = true;
                    nodePositions[targetNeuronId].connected = true;
                }
            });
        });
    });

    // --- Step 3: Draw Connections ---
    g.selectAll(".connection")
        .data(allConnections) // Already filtered for valid nodes in Step 2
        .enter().append("line")
        .attr("class", "connection")
        .attr("x1", d => nodePositions[d.from].x)
        .attr("y1", d => nodePositions[d.from].y)
        .attr("x2", d => nodePositions[d.to].x)
        .attr("y2", d => nodePositions[d.to].y)
        .attr("stroke", d => d.weight > 0 ? "#66BB6A" : "#EF5350") // Material green/red shades
        .attr("stroke-width", d => Math.min(4, Math.max(0.5, Math.abs(d.weight) * 1.5))) // Adjusted thickness range
        .attr("opacity", d => Math.min(0.8, Math.max(0.1, Math.abs(d.weight) * 0.7))); // Opacity based on weight

    // --- Step 4: Draw Nodes ---
    const nodes = g.selectAll(".node")
        .data(Object.values(nodePositions)) // Use the values (node data) from the position map
        .enter().append("g")
        .attr("class", d => `node type-${d.neuron.type}`) // Add type class for potential CSS styling
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .style("cursor", "default") // Indicate interactibility
        .on("mouseover", showTooltip)
        .on("mouseout", hideTooltip);

    // Node circles (background)
    nodes.append("circle")
        .attr("r", 10) // Slightly smaller radius
        .attr("fill", d => d.connected ? d3.interpolateRdYlGn((d.activation + 1) / 2) : "#E0E0E0") // Grey for disconnected
        .attr("stroke", "#555")
        .attr("stroke-width", 1);

    // Node Icons (using neuron.icon if available)
    nodes.append("text")
        .attr("class", "node-icon")
        .attr("y", 4) // Adjust vertical alignment
        .attr("text-anchor", "middle")
        .attr("font-size", "10px") // Slightly smaller icon font
        .style("pointer-events", "none") // Prevent text from blocking mouse events on circle
        .text(d => d.neuron.icon || '❓'); // Use neuron's icon property directly

    // Node Labels (Sensor Role or Type/Index) - positioned below node
    nodes.append("text")
        .attr("class", "node-label")
        .attr("x", -25) // Position below the circle
        .attr("text-anchor", "middle")
        .attr("font-size", "8px") // Smaller label font
        .attr("fill", "#444")
        .text(d => {
            // If input layer and sensor role exists, show it
            if (d.neuron.layer === 0 && d.roleSensor) {
                return d.roleSensor;
            }
            // Otherwise, show TypeInitial + Index (e.g., S0, M1, O2)
            return `${d.neuron.type.charAt(0).toUpperCase()}${d.neuron.index}`;
        });

    // --- Step 5: Tooltip Setup ---
    // Ensure only one tooltip exists
    d3.select(`.${tooltipClassName}`).remove();
    const tooltip = d3.select("body").append("div")
        .attr("class", tooltipClassName) // Use class for styling
        .style("position", "absolute")
        .style("opacity", 0)
        .style("background-color", "rgba(255, 255, 255, 0.95)")
        .style("border", "1px solid #ccc")
        .style("border-radius", "4px")
        .style("padding", "8px 10px")
        .style("font-size", "11px")
        .style("pointer-events", "none") // Important: tooltip shouldn't block mouse
        .style("box-shadow", "0 2px 5px rgba(0,0,0,0.1)")
        .style("line-height", "1.4");

    function showTooltip(event, d) {
        const neuron = d.neuron;
        const specialProperties = []; // Collect type-specific properties

        // Add common properties
        specialProperties.push(`Bias: ${neuron.bias.toFixed(3)}`);
        if (neuron.state !== undefined) specialProperties.push(`State: ${neuron.state.toFixed(3)}`); // For memory neurons

        // Add type-specific properties from the neuron object
        // (Adapt these keys based on your `createNeuron` implementation)
        if (neuron.memoryWeight !== undefined) specialProperties.push(`Mem. Weight: ${neuron.memoryWeight.toFixed(3)}`);
        if (neuron.targetActivation !== undefined) specialProperties.push(`Target Act: ${neuron.targetActivation.toFixed(3)}`);
        if (neuron.influence !== undefined) specialProperties.push(`Influence: ${neuron.influence.toFixed(3)}`);
        if (neuron.sensitivity !== undefined) specialProperties.push(`Sensitivity: ${neuron.sensitivity.toFixed(3)}`);
        if (neuron.modulatorType !== undefined) specialProperties.push(`Mod. Type: ${neuron.modulatorType}`);
        if (neuron.effect !== undefined) specialProperties.push(`Mod. Effect: ${neuron.effect.toFixed(3)}`);
        if (neuron.amplitude !== undefined) specialProperties.push(`Noise Amp: ${neuron.amplitude.toFixed(3)}`);
        if (neuron.rate !== undefined) specialProperties.push(`Noise Rate: ${neuron.rate.toFixed(3)}`);
        if (neuron.threshold !== undefined) specialProperties.push(`Threshold: ${neuron.threshold.toFixed(3)}`);
        // Add more checks for other potential properties...


        tooltip.transition().duration(100).style("opacity", 0.95); // Faster fade-in
        tooltip.html(`
            <div style="font-weight:bold; margin-bottom:4px;">
                ${neuron.icon || '❓'} ${neuron.title || neuron.type} (${neuron.id})
            </div>
            <div>Layer: ${neuron.layer}, Index: ${neuron.index}</div>
            <div>Activation: ${d.activation.toFixed(3)}</div>
            ${d.roleSensor ? `<div>Sensor: ${d.roleSensor}</div>` : ''}
            ${neuron.description ? `<div style="margin-top:4px; font-style:italic; color:#555;">${neuron.description}</div>` : ''}
            ${specialProperties.length ?
                `<div style="margin-top:6px; padding-top:4px; border-top: 1px dashed #ddd;">
                    ${specialProperties.join('<br>')}
                 </div>`
                : ''
            }
            ${!d.connected ? '<div style="margin-top:4px; color:#999;">(Disconnected)</div>' : ''}
        `)
        // Position tooltip relative to mouse pointer
        .style("left", (event.pageX + 10) + "px") // Offset slightly from cursor
        .style("top", (event.pageY + 10) + "px");
    }

    function hideTooltip() {
        tooltip.transition().duration(200).style("opacity", 0); // Slightly slower fade-out
    }


    // --- Step 6: Animation Loop (Optional - for live updates) ---
    let animationFrameId = null;

    // --- Activation Flow Particles ---
    // Particles travel along connections weighted by |weight|: strong connections carry more signals.
    const particles = [];
    const particleGroup = g.append("g").attr("class", "flow-particles");
    let nextParticleIndex = 0;

    function spawnParticles() {
        if (particles.length > 150) return; // Safety cap on live particles
        const weighted = allConnections
            .filter(c => Math.abs(c.weight) > 0.15) // Only meaningful connections
            .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
        if (weighted.length === 0) return;

        // Spawn 1-3 particles per frame on random strong connections
        const count = 1 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i++) {
            const conn = weighted[Math.floor(Math.random() * weighted.length)];
            const from = nodePositions[conn.from];
            const to = nodePositions[conn.to];
            if (!from || !to) continue;
            particles.push({
                x: from.x, y: from.y,
                tx: to.x, ty: to.y,
                progress: 0,
                speed: 0.5 + Math.abs(conn.weight) * 0.3, // Faster on strong connections
                positive: conn.weight >= 0,
                node: particleGroup.append('circle')
                    .attr('r', 2.5)
                    .attr('fill', conn.weight >= 0 ? '#ffeb3b' : '#ff5252')
                    .attr('opacity', 0)
            });
        }
    }

    function updateParticles() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.progress += p.speed * 0.02;
            if (p.progress >= 1) {
                p.node.remove();
                particles.splice(i, 1);
                continue;
            }
            p.x += (p.tx - p.x) * 0.12;
            p.y += (p.ty - p.y) * 0.12;
            const opacity = Math.sin(p.progress * Math.PI); // Fade in/out
            p.node
                .attr('cx', p.x)
                .attr('cy', p.y)
                .attr('opacity', opacity);
        }
    }

    function updateVisualization() {
        // Stop if creature/brain no longer valid or if the container was removed
        if (!creature /*|| !creature.isAlive*/ || !brain || !d3.select(containerId).node()) {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            particles.forEach(p => p.node.remove());
            particles.length = 0;
            return;
        }

        // Spawn & animate flow particles
        spawnParticles();
        updateParticles();

        // --- Get latest activations ---
        // Option 1: Re-run activation (simple for standalone viz, potentially slow if sim does it too)
        // const sensorData = creature.getActiveSensors(); // Returns {sensors, roles}
        // if (sensorData.sensors.length === brain.inputSize) { // Ensure size matches before activating
        //     brain.activate(sensorData.sensors);
        // } else {
        //      console.warn("drawNetwork Animation: Sensor size mismatch, skipping activation update.");
             // This indicates a problem needing fixing in the main update loop's resize logic
        // }


        // Option 2: Assume main loop updates neuron.activation, just read it here
        // (This is generally preferred if integrated into a larger simulation)
        Object.values(nodePositions).forEach(np => {
            // Find the neuron in the brain's current structure (needed if neurons were added/removed)
            const latestNeuron = brain.neurons[np.neuron.layer]?.[np.neuron.index];
            np.activation = latestNeuron ? latestNeuron.activation : 0; // Update activation from latest state
        });


        // --- Update node appearance ---
        g.selectAll(".node circle")
            // No need for a slow transition here for live updates
            .attr("fill", d => {
                // Update activation in the bound data 'd' as well
                d.activation = nodePositions[d.neuron.id]?.activation || 0;
                return d.connected ? d3.interpolateRdYlGn((d.activation + 1) / 2) : "#E0E0E0";
            });

        // --- Request next frame ---
        animationFrameId = requestAnimationFrame(updateVisualization);
    }

    // Start the animation loop
    updateVisualization();

    // Add a cleanup function if needed (e.g., when the creature is removed or visualization hidden)
    // You might need to manage this externally, e.g., store animationFrameId with the creature/UI element
    // function cleanup() {
    //     if (animationFrameId) cancelAnimationFrame(animationFrameId);
    //     d3.select(`.${tooltipClassName}`).remove();
    //     d3.select(containerId).html("");
    // }
    // creature.cleanupVisualization = cleanup; // Example of associating cleanup
} 
