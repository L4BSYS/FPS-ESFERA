// js/03-worlddata.js (part 3/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// ==== Construction Mode Variables ====
let blueprints = []; // Stores saved structures
let placedBlocks = []; // All placed blocks
let gravityBlocks = []; // Blocks currently affected by gravity
let blockPreview; // Ghost block for placement preview
let currentBlockType = 'wood'; // Default block type
let GRAVITY = -9.8; // Gravity for falling blocks
let blockGrid = new Map(); // Spatial partitioning grid
let showDebugGrid = false;
let lastInvalidReason = "";
let placementMessageTimeout = null;
let activeParticleSystems = []; 

// Block materials
const BLOCK_MATERIALS = {
    wood: {
        material: new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.7 }),
        health: 3,
        resistance: 1,
        resourceHealth: 50, // Specific health for resource nodes
        geometry: new THREE.BoxGeometry(1, 1, 1) // You could even define geometry here
    },
    stone: {
        material: new THREE.MeshStandardMaterial({ color: 0xC0C0C0, roughness: 0.5, metalness: 0.1 }),
        health: 6,
        resistance: 2,
        resourceHealth: 80,
        geometry: new THREE.SphereGeometry( 0.8, 6, 4, 0, Math.PI * 2, 0, Math.PI )
    },
    metal: {
        material: new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.3, metalness: 0.8 }),
        health: 10,
        resistance: 3,
        resourceHealth: 100,
        geometry: new THREE.TetrahedronGeometry(0.9,0)
    }
};
// Tool Constants
const TOOLS = {
    HANDS: 'hands',
    GUN: 'gun',
    HAMMER: 'hammer',
    AXE: 'axe',
    PICKAXE: 'pickaxe'    
};
const ITEM_DEFINITIONS = {
    // Tools and Weapons
    pistol: {
      id: 'pistol',
      name: 'Pistola',
      type: 'weapon',
      toolType: TOOLS.GUN,
      ammoType: 'pistol',
      damage: 15,
      fireRate: 0.2,
      createModel: () => {
        const gunGeo = new THREE.BoxGeometry(0.3, 0.1, 0.8);
        const gunMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const model = new THREE.Mesh(gunGeo, gunMat);
        model.position.set(0.5, -0.3, -1);

        // Add a muzzle point for bullet origin
        const muzzle = new THREE.Object3D();
        muzzle.position.set(0, 0, -0.4);
        muzzle.name = 'muzzlePoint';
        model.add(muzzle);

        return model;
      },
      stackable: false
    },
    hammer: {
      id: 'hammer',
      name: 'Martillo de obra',
      type: 'tool',
      toolType: TOOLS.HAMMER,
      createModel: () => {
        const handleGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.4, 8);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const hammerHandle = new THREE.Mesh(handleGeo, handleMat);
        const headGeo = new THREE.BoxGeometry(0.2, 0.1, 0.08);
        const headMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
        const hammerHead = new THREE.Mesh(headGeo, headMat);
        hammerHead.position.y = 0.2;
        hammerHandle.add(hammerHead);
        return hammerHandle;
      },
      stackable: false
    },
    axe: {
      id: 'axe',
      name: 'Hacha de leñador',
      type: 'tool',
      toolType: TOOLS.AXE,
      efficiency: 2,
      createModel: () => {
        const handleGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.4, 8);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const hammerHandle = new THREE.Mesh(handleGeo, handleMat);
        const headGeo = new THREE.BoxGeometry(0.3, 0.3, 0.05);
        const headMat = new THREE.MeshStandardMaterial({ color: 0x0F6666 });
        const hammerHead = new THREE.Mesh(headGeo, headMat);
        hammerHead.position.y = 0.2;
        hammerHandle.add(hammerHead);
        return hammerHandle;
      },
      stackable: false
    },
    pickaxe: {
      id: 'pickaxe',
      name: 'Pico minero',
      type: 'tool',
      toolType: TOOLS.PICKAXE,
      efficiency: 2,
      createModel: () => {
        const handleGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.4, 8);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const hammerHandle = new THREE.Mesh(handleGeo, handleMat);
        const headGeo = new THREE.BoxGeometry(0.2, 0.2, 0.12);
        const headMat = new THREE.MeshStandardMaterial({ color: 0x6666F6 });
        const hammerHead = new THREE.Mesh(headGeo, headMat);
        hammerHead.position.y = 0.2;
        hammerHandle.add(hammerHead);
        return hammerHandle;
      },
      stackable: false
    },            
    // Consumables
    food: {
        id: 'food',
        name: 'Comida',
        type: 'consumable',
        healAmount: 30,
        stackable: true,
        maxStack: 5,
        createModel: () => {
          const itemGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 8);
          const itemMat = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
          const item = new THREE.Mesh(itemGeo, itemMat);
          item.isCollectible = true;
          item.inContact = true;
          item.type = 'health';
          item.userData = {
              healAmount: 30,
              collected: false
          };
          return item;
        }
    },

    toxin: {
        id: 'toxin',
        name: 'Toxina',
        type: 'consumable',
        damageAmount: 30,
        stackable: true,
        maxStack: 3,
        createModel: () => {
          const itemGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 8);
          const itemMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
          const item = new THREE.Mesh(itemGeo, itemMat);
          item.isCollectible = true;
          item.inContact = true;
          item.type = 'damage';
          item.userData = {
              damageAmount: 30,
              collected: false
          };
          return item;
        }
    },
    
    // Ammo pickups
    pistolAmmo: {
        id: 'pistol_ammo',
        name: 'Balas de pistola',
        type: 'ammo',
        ammoType: 'pistol',
        amount: 12,
        stackable: true,
        maxStack: 5,
        createModel: () => {
            const geo = new THREE.BoxGeometry(0.2, 0.1, 0.4);
            const mat = new THREE.MeshStandardMaterial({ color: 0x555555 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.isCollectible = true;
            mesh.type = 'ammo';
            mesh.userData = {
                ammoType: 'pistol',
                amount: 12,
                collected: false
            };
            return mesh;
        }
    },

    // Key item definition
    key_golden: {
        id: 'golden_key',
        name: 'Llave dorada',
        type: 'key',
        description: 'A shiny golden key that unlocks special doors',
        createModel: () => {
            // Create a 3D model for the key
            const group = new THREE.Group();
            
            // Key bow (top part)
            const bowGeo = new THREE.TorusGeometry(0.2, 0.05, 16, 32);
            const bowMat = new THREE.MeshStandardMaterial({ 
                color: 0xFFD700, 
                metalness: 0.9,
                roughness: 0.3
            });
            const bow = new THREE.Mesh(bowGeo, bowMat);
            bow.rotation.x = Math.PI/2;
            group.add(bow);
            
            // Key shaft
            const shaftGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8);
            const shaftMat = new THREE.MeshStandardMaterial({ 
                color: 0xFFD700,
                metalness: 0.8,
                roughness: 0.4
            });
            const shaft = new THREE.Mesh(shaftGeo, shaftMat);
            shaft.position.y = -0.3;
            group.add(shaft);
            
            // Key teeth (simple version)
            const teethGeo = new THREE.BoxGeometry(0.15, 0.05, 0.05);
            const teeth = new THREE.Mesh(teethGeo, bowMat);
            teeth.position.set(0, -0.6, 0);
            group.add(teeth);
            
            // Add glow effect
            const glow = new THREE.PointLight(0xFFD700, 0.5, 1);
            glow.position.set(0, 0, 0);
            group.add(glow);
            
            // Set up key properties
            group.name = "Golden Key";
            group.isCollectible = true;
            group.inContact = false;
            group.isPickupable = true;
            group.userData = {
                collected: false,
                itemData: ITEM_DEFINITIONS.key_golden,
                keyId: 'golden_key' // Unique identifier for what this key opens
            };
            
            // Add rotation animation
            group.userData.update = (delta) => {
                group.rotation.y += delta * 0.5; // Rotate slowly
                group.position.y = Math.sin(Date.now() * 0.002) * 0.1 + 1; // Bob up and down
            };
            
            return group;
        },
        stackable: false
    },
};
// Configuration Constants
const PLAYER_CONFIG = {
    height: 1.6,
    radius: 0.3,
    
    speed: 7.0,            // More realistic walking speed
    sprintMultiplier: 1.6,  // Less extreme sprint
    
    jumpSpeed: 5.0,         // More moderate jump
    gravity: -10.0,         // Adjusted gravity
    friction: 0.88,         // Slightly less friction for more slide
    acceleration: 30.0,     // More gradual acceleration
    airControl: 0.2,
    coyoteTimeMax: 0.25,
    jumpGracePeriod: 0.8, 

    sensitivity: 0.002,
    mobileSensitivity: 0.003,
    
    headBobFrequency: 1.8,  // Slower head bob
    headBobAmount: 0.03,    // Less extreme head bob
    recoilAmount: 0.02,
    recoilRecoverySpeed: 0.15,
    maxPitch: Math.PI / 2.1,
    bulletSpeed: 30.0,      // Faster bullets
    bulletLifetime: 1.5,    // Shorter lifetime
    
    groundCheckDistance: 0.1,   
    collisionEpsilon: 0.01,
    maxStepHeight: 0.3,        // Maximum step height
    stepForwardCheck: 0.1,     // Forward detection distance
    horizontalStepBoost: 0.5,  // Momentum multiplier during climbs
    maxSlopeAngle: Math.PI / 4,
    stepClimbSpeed: 0.01, 

    blockReach: 5, // Max distance for block interactions
    interactionReach: 3, // Max distance for interacting/picking up
};

