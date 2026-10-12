(function () {
  window.Game = window.Game || {};
  const Config = window.Game.Config;

  function createReferenceObject(position, color) {
    const type = Math.random();
    let geometry;
    let halfX;
    let halfZ;
    let maxH;
    if (type < 0.6) {
      const coneRadius = 1.2 + Math.random() * 1.8;
      const coneHeight = 2.5 + Math.random() * 4;
      geometry = new THREE.ConeGeometry(coneRadius, coneHeight, 7);
      // El cono está centrado en el piso: arriba se ve la mitad, y en el
      // piso el ancho es la mitad de la base.
      halfX = coneRadius * 0.5;
      halfZ = halfX;
      maxH = coneHeight * 0.5;
    } else if (type < 0.9) {
      const size = 2 + Math.random() * 3;
      const height = size * (0.3 + Math.random() * 0.7);
      geometry = new THREE.BoxGeometry(size, height, size);
      halfX = size * 0.5;
      halfZ = halfX;
      maxH = height * 0.5;
    } else {
      const coneRadius = 0.8 + Math.random() * 1.2;
      const coneHeight = 3 + Math.random() * 5;
      geometry = new THREE.ConeGeometry(coneRadius, coneHeight, 6);
      halfX = coneRadius * 0.5;
      halfZ = halfX;
      maxH = coneHeight * 0.5;
    }

    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.8 + Math.random() * 0.2,
      metalness: 0.05 + Math.random() * 0.1,
      flatShading: Math.random() > 0.5,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);

    const radialDir = position.clone().normalize();
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(defaultUp, radialDir);
    mesh.setRotationFromQuaternion(quat);
    mesh.rotateOnWorldAxis(radialDir, Math.random() * Math.PI * 2);

    return { mesh, halfX, halfZ, maxH };
  }

  function outsideYard(direction) {
    const minAngle = Config.YARD_CLEARANCE / Config.PLANET_RADIUS;
    return Math.acos(Math.min(1, Math.max(-1, direction.y))) >= minAngle;
  }

  function randomDirectionPoleWeighted() {
    const theta = Math.random() * Math.PI * 2;
    let phi;
    if (Math.random() < 0.7) {
      const u = Math.random();
      phi = u < 0.5
        ? Math.acos(1 - u * 1.8)
        : Math.acos(-1 + (u - 0.5) * 1.8);
      phi = Math.max(0.05, Math.min(Math.PI - 0.05, phi));
    } else {
      phi = Math.acos(2 * Math.random() - 1);
    }
    return new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    ).normalize();
  }

  function randomDirectionNearPole() {
    const minAngle = Config.YARD_CLEARANCE / Config.PLANET_RADIUS;
    const angleFromPole = minAngle + 0.012 + Math.random() * 0.09;
    const azimuth = Math.random() * Math.PI * 2;
    return new THREE.Vector3(
      Math.sin(angleFromPole) * Math.cos(azimuth),
      Math.cos(angleFromPole),
      Math.sin(angleFromPole) * Math.sin(azimuth)
    ).normalize();
  }

  /**
   * Crea el planeta, las luces y los objetos de referencia dispersos,
   * y los agrega a la escena provista.
   */
  window.Game.createWorld = function (scene) {
    scene.background = new THREE.Color(Config.BG_COLOR);
    scene.fog = new THREE.Fog(Config.BG_COLOR, Config.FOG_NEAR, Config.FOG_FAR);

    const ambientLight = new THREE.AmbientLight(0x1a2a3a, 0.45);
    scene.add(ambientLight);

    const playerLight = new THREE.PointLight(0x6a8aaa, 0.7, 90, 1);
    playerLight.position.set(0, Config.TARGET_DISTANCE, 0);
    scene.add(playerLight);

    const secondaryLight = new THREE.PointLight(0x1a3040, 0.2, 80, 2);
    secondaryLight.position.set(0, Config.TARGET_DISTANCE + 10, 0);
    scene.add(secondaryLight);

    const planetGeometry = new THREE.SphereGeometry(Config.PLANET_RADIUS, 80, 80);
    const planetMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1d,
      roughness: 0.85,
      metalness: 0.05,
    });
    const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
    scene.add(planetMesh);

    const referenceObjects = [];

    function placeRock(direction) {
      const position = direction.clone().multiplyScalar(Config.PLANET_RADIUS);
      const color = Config.DARK_COLORS[Math.floor(Math.random() * Config.DARK_COLORS.length)];
      const built = createReferenceObject(position, color);
      scene.add(built.mesh);
      const frame = window.Game.frameFromQuaternion(built.mesh.position, built.mesh.quaternion);
      const col = window.Game.Colliders.add(
        frame,
        -built.halfX, built.halfX,
        -built.halfZ, built.halfZ,
        0, built.maxH
      );
      built.mesh.userData.solid = col;
      referenceObjects.push(built.mesh);
    }

    for (let i = 0; i < Config.TOTAL_REFERENCE_OBJECTS; i++) {
      let direction = randomDirectionPoleWeighted();
      for (let n = 0; n < 40 && !outsideYard(direction); n++) {
        direction = randomDirectionPoleWeighted();
      }
      if (!outsideYard(direction)) {
        const a = Config.YARD_CLEARANCE / Config.PLANET_RADIUS + 0.02;
        const azimuth = (i / Config.TOTAL_REFERENCE_OBJECTS) * Math.PI * 2;
        direction = new THREE.Vector3(
          Math.sin(a) * Math.cos(azimuth),
          Math.cos(a),
          Math.sin(a) * Math.sin(azimuth)
        );
      }
      placeRock(direction);
    }

    for (let i = 0; i < Config.REFERENCE_OBJECTS_NEAR_SPAWN; i++) {
      placeRock(randomDirectionNearPole());
    }

    return { planetMesh, referenceObjects, playerLight, secondaryLight };
  };
})();
