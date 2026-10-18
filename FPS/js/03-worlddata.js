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
    PICKAXE: 'pickaxe',
    TORCH: 'torch'
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
        const g = new THREE.Group();
        const steel = new THREE.MeshStandardMaterial({ color: 0x2b2d33, metalness: 0.85, roughness: 0.35 });
        const steelDark = new THREE.MeshStandardMaterial({ color: 0x161719, metalness: 0.9, roughness: 0.4 });
        const gripMat = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.85 });

        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.62), steel);
        slide.position.set(0, 0.02, -0.02); g.add(slide);
        const slideTop = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.6), steelDark);
        slideTop.position.set(0, 0.1, -0.02); g.add(slideTop);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.36, 10), steelDark);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.42); g.add(barrel);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.4, 0.17), gripMat);
        grip.position.set(0, -0.2, 0.16); grip.rotation.x = -0.28; g.add(grip);
        const guard = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 14, Math.PI), steel);
        guard.rotation.x = Math.PI / 2; guard.position.set(0, -0.09, -0.04); g.add(guard);
        const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.07, 0.025), steelDark);
        trigger.position.set(0, -0.07, -0.04); g.add(trigger);
        const sightF = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), steelDark);
        sightF.position.set(0, 0.13, -0.3); g.add(sightF);
        const sightB = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.02), steelDark);
        sightB.position.set(0, 0.13, 0.22); g.add(sightB);
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), steelDark);
        mag.position.set(0, -0.16, 0.02); g.add(mag);

        const muzzle = new THREE.Object3D();
        muzzle.position.set(0, 0.02, -0.62);
        muzzle.name = 'muzzlePoint';
        g.add(muzzle);
        return g;
      },
      stackable: false
    },
    hammer: {
      id: 'hammer',
      name: 'Martillo de obra',
      type: 'tool',
      toolType: TOOLS.HAMMER,
      createModel: () => {
        const g = new THREE.Group();
        const wood = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.85 });
        const wrap = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.95 });
        const metal = new THREE.MeshStandardMaterial({ color: 0x7c828a, metalness: 0.8, roughness: 0.35 });
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.52, 8), wood);
        g.add(handle);
        const gripWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.14, 8), wrap);
        gripWrap.position.y = -0.2; g.add(gripWrap);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.11), metal);
        head.position.y = 0.26; g.add(head);
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.17, 4), metal);
        claw.rotation.z = Math.PI / 2; claw.position.set(0.18, 0.26, 0); g.add(claw);
        return g;
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
        const g = new THREE.Group();
        const wood = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.85 });
        const wrap = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.95 });
        const metal = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 0.85, roughness: 0.3 });
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.58, 8), wood);
        g.add(handle);
        const gripWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 8), wrap);
        gripWrap.position.y = -0.22; g.add(gripWrap);
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.14), metal);
        eye.position.y = 0.28; g.add(eye);
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.3), metal);
        blade.position.set(0.07, 0.28, 0.09); g.add(blade);
        const cheek = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.2, 4), metal);
        cheek.rotation.set(Math.PI / 2, 0, Math.PI / 2); cheek.position.set(0.06, 0.28, 0.18); g.add(cheek);
        return g;
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
        const g = new THREE.Group();
        const wood = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.85 });
        const wrap = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.95 });
        const metal = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 0.85, roughness: 0.3 });
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.58, 8), wood);
        g.add(handle);
        const gripWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 8), wrap);
        gripWrap.position.y = -0.22; g.add(gripWrap);
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.07), metal);
        cross.position.y = 0.28; g.add(cross);
        const tipL = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 6), metal);
        tipL.rotation.z = Math.PI / 2; tipL.position.set(-0.32, 0.28, 0); g.add(tipL);
        const tipR = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 6), metal);
        tipR.rotation.z = -Math.PI / 2; tipR.position.set(0.32, 0.28, 0); g.add(tipR);
        return g;
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
          const g = new THREE.Group();
          const bunMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.9 });
          const meatMat = new THREE.MeshStandardMaterial({ color: 0x7a3b1e, roughness: 0.85 });
          const cheeseMat = new THREE.MeshStandardMaterial({ color: 0xffd54a, roughness: 0.7 });
          const lettuceMat = new THREE.MeshStandardMaterial({ color: 0x67b34a, roughness: 0.9 });
          const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.14, 12), bunMat);
          bottom.position.y = -0.12; g.add(bottom);
          const meat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), meatMat);
          g.add(meat);
          const cheese = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.46), cheeseMat);
          cheese.position.y = 0.06; g.add(cheese);
          const lettuce = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 14), lettuceMat);
          lettuce.rotation.x = Math.PI / 2; lettuce.position.y = 0.1; g.add(lettuce);
          const top = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), bunMat);
          top.position.y = 0.14; g.add(top);
          g.isCollectible = true;
          g.inContact = true;
          g.type = 'food';
          g.userData = { healAmount: 30, collected: false };
          return g;
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
          const g = new THREE.Group();
          const glassMat = new THREE.MeshStandardMaterial({ color: 0x2f8b4a, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
          const liquidMat = new THREE.MeshStandardMaterial({ color: 0x8dff7a, emissive: 0x2f8b1a, emissiveIntensity: 0.5, roughness: 0.4 });
          const capMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
          const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.4, 12), glassMat);
          g.add(body);
          const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.26, 12), liquidMat);
          liquid.position.y = -0.05; g.add(liquid);
          const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.12, 10), glassMat);
          neck.position.y = 0.24; g.add(neck);
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10), capMat);
          cap.position.y = 0.31; g.add(cap);
          g.isCollectible = true;
          g.inContact = true;
          g.type = 'toxin';
          g.userData = { damageAmount: 30, collected: false };
          return g;
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
            const g = new THREE.Group();
            const boxMat = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.6, metalness: 0.3 });
            const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 });
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.22), boxMat);
            g.add(box);
            const lid = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.24), boxMat);
            lid.position.y = 0.09; g.add(lid);
            for (let i = -1; i <= 1; i++) {
                const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), brassMat);
                b.rotation.x = Math.PI / 2; b.position.set(i * 0.09, 0.14, 0); g.add(b);
            }
            g.isCollectible = true;
            g.type = 'ammo';
            g.userData = {
                ammoType: 'pistol',
                amount: 12,
                collected: false
            };
            return g;
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

    // Recursos que se juntan sin herramienta (se suman a wood/stone/metal)
    branch: {
        id: 'branch',
        name: 'Rama',
        type: 'resource',
        resourceKey: 'wood',
        amount: 2,
        stackable: true,
        maxStack: 9,
        createModel: () => {
            const g = new THREE.Group();
            const mat = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.9 });
            const main = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 6), mat);
            main.rotation.z = Math.PI / 2.2;
            g.add(main);
            const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 5), mat);
            twig.position.set(0.1, 0.12, 0);
            twig.rotation.z = -Math.PI / 3;
            g.add(twig);
            return g;
        }
    },
    pebble: {
        id: 'pebble',
        name: 'Piedra suelta',
        type: 'resource',
        resourceKey: 'stone',
        amount: 2,
        stackable: true,
        maxStack: 9,
        createModel: () => {
            const g = new THREE.Group();
            const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.95 });
            [[0, 0, 0, 0.16], [0.14, 0.03, 0.05, 0.11], [-0.1, 0.02, -0.08, 0.1]].forEach(([x, y, z, r]) => {
                const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat);
                m.position.set(x, y, z);
                g.add(m);
            });
            return g;
        }
    },
    scrap: {
        id: 'scrap',
        name: 'Chatarra',
        type: 'resource',
        resourceKey: 'metal',
        amount: 2,
        stackable: true,
        maxStack: 9,
        createModel: () => {
            const g = new THREE.Group();
            const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.8, roughness: 0.4 });
            const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.25), mat);
            plate.rotation.y = 0.4;
            g.add(plate);
            const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), mat);
            bolt.position.set(0.12, 0.06, 0);
            g.add(bolt);
            const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), mat);
            rod.rotation.z = Math.PI / 2.5;
            rod.position.set(-0.1, 0.08, 0.05);
            g.add(rod);
            return g;
        }
    },

    // Consumible: cura 30 al usarla desde la mochila
    bandage: {
        id: 'bandage',
        name: 'Venda',
        type: 'consumable',
        healAmount: 30,
        stackable: true,
        maxStack: 10,
        createModel: () => {
            const g = new THREE.Group();
            const roll = new THREE.Mesh(
                new THREE.CylinderGeometry(0.18, 0.18, 0.16, 12),
                new THREE.MeshStandardMaterial({ color: 0xf2f2ec, roughness: 0.9 })
            );
            roll.rotation.z = Math.PI / 2;
            g.add(roll);
            const band = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.5, 0.03),
                new THREE.MeshStandardMaterial({ color: 0xd94f4f, roughness: 0.8 })
            );
            band.position.set(0.05, -0.28, 0);
            band.rotation.z = 0.3;
            g.add(band);
            return g;
        }
    },

    // Herramienta-antorchas: emite luz mientras la tenés equipada
    torch: {
        id: 'torch',
        name: 'Antorcha',
        type: 'tool',
        toolType: TOOLS.TORCH,
        stackable: false,
        createModel: () => {
            const g = new THREE.Group();
            const handle = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.04, 0.5, 6),
                new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 })
            );
            handle.position.y = -0.1;
            g.add(handle);
            const flame = new THREE.Mesh(
                new THREE.ConeGeometry(0.09, 0.24, 8),
                new THREE.MeshBasicMaterial({ color: 0xffb300 })
            );
            flame.position.y = 0.28;
            g.add(flame);
            const core = new THREE.Mesh(
                new THREE.ConeGeometry(0.05, 0.14, 8),
                new THREE.MeshBasicMaterial({ color: 0xfff2a8 })
            );
            core.position.y = 0.3;
            g.add(core);
            const light = new THREE.PointLight(0xffb060, 1.6, 16, 2);
            light.position.y = 0.34;
            light.name = 'torchLight';
            g.add(light);
            g.userData.flame = flame;
            g.userData.core = core;
            g.userData.light = light;
            return g;
        }
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

