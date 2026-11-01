// js/01-config.js (part 1/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// ==== Globals ====
let debugMode = false;
let isGamePaused = false;
let isMobile = false;

let scene, renderer, camera;
let player, clock, keys = {};
let weapon, muzzleFlash; 

let shootCooldown = 0;
let meleeCooldown = 0;
let groundMesh; // Keep a direct reference to the ground

let collidableObjects = [];
let bullets = []; // Array to track active bullets
let npcs = []; // Array to hold multiple NPCs

