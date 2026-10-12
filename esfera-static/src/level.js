(function () {
  window.Game = window.Game || {};

  const WALL_HEIGHT = 4;

  function buildBoxMesh(frame, x, z, w, d, height, color, emissive) {
    const geometry = new THREE.BoxGeometry(w, height, d);
    const material = new THREE.MeshStandardMaterial({
      color, emissive: emissive || 0x000000, roughness: 0.6, metalness: 0.25,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(frame.localToWorld(x, z, height / 2));
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), frame.up);
    mesh.setRotationFromQuaternion(quat);
    return mesh;
  }

  /**
   * Crea una muestra mínima de cada sistema del laberinto original (pared,
   * puerta automática, puerta con llave + botón, ascensor, luz, ítem) cerca
   * del spawn. No es una réplica del laberinto completo — es un
   * showcase/debug de que cada mecánica sobrevive el salto a la esfera.
   */
  window.Game.createLevel = function (scene) {
    const Config = window.Game.Config;
    const Colliders = window.Game.Colliders;
    const GroundHeight = window.Game.GroundHeight;
    const Audio = window.Game.Audio;

    const spawnPos = new THREE.Vector3(0, Config.TARGET_DISTANCE, 0);
    const frame = window.Game.LocalFrame(spawnPos);

    // ---------- 1) Pared (colisión con objeto estático) ----------
    const wall = buildBoxMesh(frame, 7, 0, 1, 5, WALL_HEIGHT, 0x552222);
    scene.add(wall);
    Colliders.add(frame, 6.5, 7.5, -2.5, 2.5);

    // ---------- 2) Puerta automática ----------
    const autoDoorMesh = buildBoxMesh(frame, 0, -7, 1, 2, WALL_HEIGHT, 0x556688, 0x111133);
    scene.add(autoDoorMesh);
    const autoDoorCollider = Colliders.add(frame, -0.5, 0.5, -8, -6);
    const autoDoor = {
      mesh: autoDoorMesh, collider: autoDoorCollider,
      localX: 0, localZ: -7,
      state: 'closed', closedH: WALL_HEIGHT / 2, openH: WALL_HEIGHT * 1.6,
      waitTimer: 0,
    };

    // ---------- 3) Puerta con llave + botón ----------
    const lockedDoorMesh = buildBoxMesh(frame, -8, 5, 1, 1, WALL_HEIGHT, 0x664400, 0x221100);
    scene.add(lockedDoorMesh);
    const lockedDoorCollider = Colliders.add(frame, -8.5, -7.5, 4.5, 5.5);
    const lockedDoor = {
      mesh: lockedDoorMesh, collider: lockedDoorCollider,
      state: 'closed', closedH: WALL_HEIGHT / 2, openH: WALL_HEIGHT * 1.6,
    };

    const buttonGroup = new THREE.Group();
    const buttonBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 1, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 })
    );
    const buttonLightMat = new THREE.MeshStandardMaterial({
      color: 0xff2222, emissive: 0xaa0000, emissiveIntensity: 1,
    });
    const buttonLightMesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.05), buttonLightMat);
    buttonLightMesh.position.set(0, 0.2, 0.11);
    buttonGroup.add(buttonBase, buttonLightMesh);
    buttonGroup.position.copy(frame.localToWorld(-14, 5, 0.9));
    scene.add(buttonGroup);
    const button = {
      localX: -14, localZ: 5, lightMat: buttonLightMat, activated: false,
    };

    // ---------- 4) Ascensor ----------
    const elevatorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.2, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x888822, emissive: 0x333300, metalness: 0.4, roughness: 0.5 })
    );
    scene.add(elevatorMesh);
    const elevator = {
      mesh: elevatorMesh, localX: 10, localZ: 8, halfX: 1.3, halfZ: 1.3,
      y: 0, topY: 4.5, speed: 1.3, state: 'idle', timer: 0,
    };
    GroundHeight.register((worldPos) => {
      const { x, z } = frame.worldToLocalXZ(worldPos);
      const within = x > elevator.localX - elevator.halfX && x < elevator.localX + elevator.halfX &&
                     z > elevator.localZ - elevator.halfZ && z < elevator.localZ + elevator.halfZ;
      return within ? elevator.y : 0;
    });

    // ---------- 5) Luz (torch fija, distinta de las luces que siguen al jugador) ----------
    const torchLight = new THREE.PointLight(0xff9944, 1.2, 12, 2);
    torchLight.position.copy(frame.localToWorld(2, 3, 2.2));
    scene.add(torchLight);
    const torchMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0xff9944, emissive: 0xff6600, emissiveIntensity: 1.5 })
    );
    torchMesh.position.copy(frame.localToWorld(2, 3, 2.2));
    scene.add(torchMesh);

    // ---------- 6) Ítem (botiquín) ----------
    const itemGroup = new THREE.Group();
    const itemBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x662222, roughness: 0.4 })
    );
    const crossMat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xaa0000 });
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.09), crossMat);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.32, 0.09), crossMat);
    bar1.position.z = 0.26; bar2.position.z = 0.26;
    itemGroup.add(itemBase, bar1, bar2);
    scene.add(itemGroup);
    const item = { group: itemGroup, localX: -3, localZ: -3, baseHeight: 0.6, alive: true, bob: 0 };

    // ---------- 7) Ítem (caja de munición) ----------
    const ammoGroup = new THREE.Group();
    const ammoBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.28, 0.28),
      new THREE.MeshStandardMaterial({ color: 0xdddd33, emissive: 0x555511, roughness: 0.4, metalness: 0.3 })
    );
    ammoGroup.add(ammoBox);
    scene.add(ammoGroup);
    const ammoItem = { group: ammoGroup, localX: -3, localZ: 1, baseHeight: 0.55, alive: true };

    // ---------- Lógica de actualización ----------
    function updateAutoDoor(dt, playerWorldPos) {
      const { x, z } = frame.worldToLocalXZ(playerWorldPos);
      const dist = Math.hypot(x - autoDoor.localX, z - autoDoor.localZ);
      const near = dist < 3;

      if (near && autoDoor.state === 'closed') {
        autoDoor.state = 'opening';
        autoDoor.collider.active = false;
        if (Audio) Audio.door();
      }
      if (autoDoor.state === 'open') {
        autoDoor.waitTimer = near ? 0 : autoDoor.waitTimer + dt;
        if (autoDoor.waitTimer > 1.2) {
          autoDoor.state = 'closing';
          if (Audio) Audio.door();
        }
      }

      if (autoDoor.state === 'opening' || autoDoor.state === 'closing') {
        // el estado se resuelve en _animateDoorHeight, llamado más abajo
      }

      // Animar altura de la puerta reconstruyendo su posición mundial
      const worldPos = frame.localToWorld(
        autoDoor.localX, autoDoor.localZ,
        _animateDoorHeight(autoDoor, dt)
      );
      autoDoor.mesh.position.copy(worldPos);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), frame.up);
      autoDoor.mesh.setRotationFromQuaternion(quat);
    }

    function updateLockedDoor(dt) {
      if (lockedDoor.state === 'closed') return; // nunca se anima si sigue cerrada
      const worldPos = frame.localToWorld(-8, 5, _animateDoorHeight(lockedDoor, dt));
      lockedDoor.mesh.position.copy(worldPos);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), frame.up);
      lockedDoor.mesh.setRotationFromQuaternion(quat);
    }

    function _animateDoorHeight(door, dt) {
      if (!door._h && door._h !== 0) door._h = door.closedH;
      if (door.state === 'opening') {
        door._h = Math.min(door.openH, door._h + 3 * dt);
        if (door._h >= door.openH) door.state = 'open';
      } else if (door.state === 'closing') {
        door._h = Math.max(door.closedH, door._h - 3 * dt);
        if (door._h <= door.closedH) {
          door._h = door.closedH;
          door.state = 'closed';
          door.collider.active = true;
        }
      }
      return door._h - WALL_HEIGHT / 2; // altura relativa al centro original de la caja
    }

    function updateElevator(dt) {
      if (elevator.state === 'rising') {
        elevator.y = Math.min(elevator.topY, elevator.y + elevator.speed * dt);
        if (elevator.y >= elevator.topY) { elevator.state = 'up'; elevator.timer = 0; }
      } else if (elevator.state === 'up') {
        elevator.timer += dt;
        if (elevator.timer > 3.5) elevator.state = 'lowering';
      } else if (elevator.state === 'lowering') {
        elevator.y = Math.max(0, elevator.y - elevator.speed * dt);
        if (elevator.y <= 0) elevator.state = 'idle';
      }
      elevator.mesh.position.copy(frame.localToWorld(elevator.localX, elevator.localZ, elevator.y + 0.1));
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), frame.up);
      elevator.mesh.setRotationFromQuaternion(quat);
    }

    function updateElevatorTrigger(playerWorldPos, isGrounded) {
      if (elevator.state !== 'idle') return;
      const { x, z } = frame.worldToLocalXZ(playerWorldPos);
      const within = x > elevator.localX - elevator.halfX && x < elevator.localX + elevator.halfX &&
                     z > elevator.localZ - elevator.halfZ && z < elevator.localZ + elevator.halfZ;
      if (within && isGrounded) {
        elevator.state = 'rising';
        if (Audio) Audio.elevator();
      }
    }

    function updateItem(dt, t, playerWorldPos) {
      if (!item.alive) return;
      const worldPos = frame.localToWorld(item.localX, item.localZ, item.baseHeight + Math.sin(t * 2) * 0.1);
      item.group.position.copy(worldPos);
      item.group.rotation.y = t * 1.4;

      const dist = playerWorldPos.distanceTo(worldPos);
      if (dist < 1.5) {
        if (window.Game.PlayerHealth && window.Game.PlayerHealth.hp < window.Game.PlayerHealth.maxHp) {
          window.Game.PlayerHealth.heal(25);
          if (Audio) Audio.pickup('health');
          item.alive = false;
          scene.remove(item.group);
        }
      }
    }

    let weaponRef = null;

    function updateAmmoItem(dt, t, playerWorldPos) {
      if (!ammoItem.alive) return;
      const worldPos = frame.localToWorld(ammoItem.localX, ammoItem.localZ, ammoItem.baseHeight + Math.sin(t * 2 + 1.5) * 0.1);
      ammoItem.group.position.copy(worldPos);
      ammoItem.group.rotation.y = t * 1.4;

      const dist = playerWorldPos.distanceTo(worldPos);
      if (dist < 1.5 && weaponRef) {
        weaponRef.addReserve(12);
        if (Audio) Audio.pickup('ammo');
        ammoItem.alive = false;
        scene.remove(ammoItem.group);
      }
    }

    return {
      frame,
      setWeapon(weapon) { weaponRef = weapon; },
      update(dt, t, playerWorldPos, isGrounded) {
        updateAutoDoor(dt, playerWorldPos);
        updateLockedDoor(dt);
        updateElevator(dt);
        updateElevatorTrigger(playerWorldPos, isGrounded);
        updateItem(dt, t, playerWorldPos);
        updateAmmoItem(dt, t, playerWorldPos);
      },
      tryInteract(playerWorldPos) {
        if (button.activated) return;
        const { x, z } = frame.worldToLocalXZ(playerWorldPos);
        const dist = Math.hypot(x - button.localX, z - button.localZ);
        if (dist < 2.3) {
          button.activated = true;
          button.lightMat.color.setHex(0x22ff44);
          button.lightMat.emissive.setHex(0x00aa22);
          if (Audio) Audio.button();
          lockedDoor.state = 'opening';
          lockedDoor.collider.active = false;
          if (Audio) Audio.door();
        }
      },
    };
  };
})();
