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

    // Sol pálido sobre el polo de spawn: referencia y orientación. La luz
    // direccional viaja paralela al eje del polo, así que solo baña el
    // hemisferio que la mira (el de spawn); la otra mitad queda a la
    // penumbra del ambiente. Pálido a propósito: calienta sin encandilar.
    const sunDir = new THREE.Vector3(0, 1, 0);
    const sunLight = new THREE.DirectionalLight(0xf0e4c8, 0.95);
    sunLight.position.copy(sunDir.clone().multiplyScalar(Config.PLANET_RADIUS + 380));
    sunLight.target.position.set(0, 0, 0);
    scene.add(sunLight);
    scene.add(sunLight.target);

    // Disco visible del sol (la niebla no lo toca, para verlo de lejos).
    // Desde el spawn se lo ve mirando arriba; desde la antípoda lo tapa el
    // planeta. Entra en el far de la cámara (800).
    const sunMesh = new THREE.Mesh(
      new THREE.CircleGeometry(26, 40),
      new THREE.MeshBasicMaterial({ color: 0xf3ead2, fog: false })
    );
    sunMesh.position.copy(sunDir.clone().multiplyScalar(Config.PLANET_RADIUS + 640));
    sunMesh.lookAt(0, 0, 0);
    sunMesh.raycast = function () {};
    scene.add(sunMesh);
    const sunHalo = new THREE.Mesh(
      new THREE.CircleGeometry(44, 40),
      new THREE.MeshBasicMaterial({ color: 0xe8dcc0, transparent: true, opacity: 0.22, fog: false, depthWrite: false })
    );
    sunHalo.position.copy(sunDir.clone().multiplyScalar(Config.PLANET_RADIUS + 639));
    sunHalo.lookAt(0, 0, 0);
    sunHalo.raycast = function () {};
    scene.add(sunHalo);

    const planetGeometry = new THREE.SphereGeometry(Config.PLANET_RADIUS, 80, 80);
    const planetMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1d,
      roughness: 0.85,
      metalness: 0.05,
    });
    const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
    scene.add(planetMesh);

    const referenceObjects = [];

    return { planetMesh, referenceObjects, playerLight, secondaryLight, sunLight, sunMesh };
  };
})();
