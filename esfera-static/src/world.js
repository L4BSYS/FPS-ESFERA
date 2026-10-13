(function () {
  window.Game = window.Game || {};
  const Config = window.Game.Config;

  /**
   * Crea el planeta vacío (luces y niebla). Los mojones y recursos los
   * puebla wilds.js con la semilla del mapa.
   */
  window.Game.createWorld = function (scene, seed) {
    // El mundo arranca vacío: planeta, niebla y luces. Los mojones y los
    // recursos los puebla wilds.js con la misma semilla (seed), así el mapa
    // es idéntico en todas las máquinas. La semilla queda por si vuelve
    // algún decorado procederal.
    void seed;
    scene.background = new THREE.Color(Config.BG_COLOR);
    scene.fog = new THREE.Fog(Config.BG_COLOR, Config.FOG_NEAR, Config.FOG_FAR);

    const ambientLight = new THREE.AmbientLight(0x1a2a3a, 0.34);
    scene.add(ambientLight);

    const playerLight = new THREE.PointLight(0x6a8aaa, 0.55, 90, 1);
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

    return { planetMesh, referenceObjects, playerLight, secondaryLight };
  };
})();
