// Se carga como <script> clásico (no módulo), así funciona con doble click
// abriendo index.html directamente, sin servidor.
(function () {
  window.Game = window.Game || {};

  window.Game.Config = {
    // Planeta y jugador
    PLANET_RADIUS: 500,
    EYE_HEIGHT: 1.6,
    TARGET_DISTANCE: 500 + 1.6,

    // Movimiento
    WALK_SPEED: 12,
    RUN_SPEED: 22,
    JUMP_IMPULSE: 10,
    GRAVITY: 20,
    // Localidad de marcos: un collider o interactuable solo vale si su
    // ancla está a menos de esto del punto consultado. Sin esto, la
    // antípoda del spawn se proyecta sobre la puerta y atiende la E
    // (puerta fantasma) y frena donde no hay nada.
    FRAME_RANGE: 120,
    // Zona de spawn: los nuevos arrancan acá. Radio grande sin
    // construcción (estructuras) y campamentos enemigos bien afuera.
    SPAWN_X: 0,
    SPAWN_Z: -2,
    SPAWN_SAFE_R: 8,
    // Campamentos fuera de vista (14) y de tiro (15) del spawn.
    CAMP_MIN_SPAWN_DIST: 25,
    CAMP_MAX_SPAWN_DIST: 40,
    // La aceleración manda al arrancar (el test de feel exige
    // que el aire sea <60% del piso) y la fricción al soltar. Subir solo la
    // fricción quita lo resbaloso sin romper el test.
    MOUSE_SENSITIVITY: 0.002,
    PITCH_CLAMP: Math.PI / 2 - 0.15, // ~81°
    ACCELERATION: 40,
    FRICTION: 36,
    // Salto poco después de dejar el piso, y menos mando en el aire.
    COYOTE_TIME: 0.2,
    AIR_CONTROL: 0.35,

    // Estética
    BG_COLOR: 0x0a0a0a,
    FOG_NEAR: 25,
    FOG_FAR: 160,

    // Objetos de referencia dispersos. No nacen dentro del patio:
    // la losa llega a unos 28 m del polo.
    TOTAL_REFERENCE_OBJECTS: 60,
    REFERENCE_OBJECTS_NEAR_SPAWN: 15,
    YARD_CLEARANCE: 32,

    DARK_COLORS: [
      0x2a2a2e, 0x1e1e22, 0x252528, 0x2d2d32, 0x1a1a1f,
      0x222228, 0x2f2f35, 0x1c1c20, 0x28282d, 0x303035,
      0x1f1f24, 0x2b2b30, 0x26262a, 0x1d1d21, 0x2c2c31,
      0x232327, 0x1b1b1f, 0x2e2e33, 0x27272c, 0x202025,
    ],

    // Colisión estática (ancho/alto/profundidad "de mundo", en unidades
    // locales al ancla del showcase)
    PLAYER_RADIUS: 0.4,
    ENEMY_RADIUS: 0.45,
    WALL_H: 4,

    // Armas / munición
    MAG_SIZE: 12,
    MAX_RESERVE: 90,

    // Enemigos
    ENEMY_SIGHT_RANGE: 16,
    ENEMY_ATTACK_RANGE: 4.5,

    // Puertas / plataforma
    DOOR_SPEED: 3,
    ELEVATOR_SPEED: 1.3,
    ELEVATOR_TOP: 4.5,
  };
})();
