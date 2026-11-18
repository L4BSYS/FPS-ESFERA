// js/bodyRig.js — shared humanoid BodyRig / Driver / Skin for FPS La Grieta.
// Ported from SKETCH FPS/player/sketch-player.html v3 (PR0). Classic script, no ES modules.
// LOAD: after 03-worlddata.js, before 04-character.js.
//
// CONTRACT (Fase F freeze — local integration DONE)
// - Character/cápsula owns locomotion + world collision. This module is visual + poses only.
// - Axes: +Y up, +Z character forward, anatomicalRight = local −X (joints *_R at x≤0).
// - Mount: BODY_MOUNT.yawNpc (NPC) / yawPlayer (1P). Feet at y≈0 of body.root → parent y=-halfHeight.
// - Do NOT port sketch stepCapsule / AABB / AI / portals.
// - Online: stream poseId (compact int 0–5 today); never 17 quaternions. Remotes = capsules until
//   PLAYER_CONFIG.onlineBody is flipped by a dedicated plan (see ONLINE_BODY_PLACEHOLDER in 17-net.js).
// - Third-person: PLAYER_CONFIG.thirdPerson stays false; body is already 3P-capable as NPC visuals.
//
(function (global) {
  'use strict';

  var REF_HEIGHT = (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.height) ? PLAYER_CONFIG.height : 1.6;

  /** Frozen body definition (sketch proposedBody subset). */
  var BODY_DEF = {
    topologyVersion: 1,
    /**
     * World scale contract (props + body share this).
     * 1 Three.js unit = 1 meter. Player / normie height = PLAYER_CONFIG.height (1.6 m).
     * Camera viewmodels in ITEM_DEFINITIONS are authored oversized for FOV; when parenting
     * those meshes to body sockets use viewmodelToWorld (or per-item override).
     */
    scale: {
      metersPerUnit: 1,
      referenceHeightM: REF_HEIGHT,
      // Approx body landmarks at referenceHeight (meters) — for prop authors / future mounts
      handWidthM: 0.085,
      forearmLenM: 0.26,
      upperArmLenM: 0.28,
      // Default: viewmodel mesh → world socket. Pistol authored ~0.62 m long as VM; real ~0.20 m.
      viewmodelToWorld: 0.32,
      items: {
        pistol: 0.30,
        hammer: 0.34,
        axe: 0.34,
        pickaxe: 0.34,
        torch: 0.36
      }
    },
    /**
     * Grip + hold when mounting viewmodels on wrist_R.
     *
     * Mesh facts (ITEM_DEFINITIONS createModel):
     * - pistol: barrel −Z, grip mesh ≈ (0,-0.2,0.16)
     * - hammer/axe/pickaxe: shaft +Y, grip wrap ≈ y=-0.2, head at +Y
     * - torch: shaft +Y, flame at +Y
     *
     * mode 'hold': desiredWorld = cameraQuat * holdEuler (YXZ). NOT aimed at crosshair.
     * local: point on the mesh that sits in the palm (pre-scale).
     * palm: offset of that point in wrist_R / toolMount space.
     * lookFollow 0..1: extra cam-pitch bias. smooth: slerp rate.
     *
     * Playtest (1P, look down ~45°): fist visible lower-right; shaft/blade readable;
     * no mesh through camera; holster pistol sits on hip when tool ≠ gun.
     */
    grips: {
      // Barrel along look, grip in palm, slight muzzle-down cant (classic FPS hip-ready).
      pistol: {
        local: [0, -0.18, 0.14], palm: [0.018, 0.022, 0.018],
        mode: 'hold', holdEuler: [0.20, 0.04, 0.10], lookFollow: 0.16, smooth: 11
      },
      // Shaft up-forward; head above fist to screen-right (claw readable).
      hammer: {
        local: [0, -0.20, 0], palm: [0.022, 0.018, 0.016],
        mode: 'hold', holdEuler: [-0.72, 0.18, 0.58], lookFollow: 0.08, smooth: 9
      },
      // Blade cheek toward view-forward; bit more yaw than hammer so edge reads.
      axe: {
        local: [0, -0.22, 0], palm: [0.022, 0.018, 0.016],
        mode: 'hold', holdEuler: [-0.68, 0.42, 0.38], lookFollow: 0.08, smooth: 9
      },
      // Crossbar ~screen-horizontal; less yaw than axe so tips stay L/R.
      pickaxe: {
        local: [0, -0.22, 0], palm: [0.022, 0.018, 0.016],
        mode: 'hold', holdEuler: [-0.70, 0.08, 0.55], lookFollow: 0.08, smooth: 9
      },
      // Flame up + slight forward; low lookFollow so it doesn't jab the lens.
      torch: {
        local: [0, -0.16, 0], palm: [0.016, 0.028, 0.014],
        mode: 'hold', holdEuler: [-0.12, 0.14, 0.22], lookFollow: 0.04, smooth: 8
      }
    },
    /** Pistol on hip_R when not in hand (Fase D). Grip → hip socket; barrel down-back. */
    holster: {
      itemId: 'pistol',
      socket: 'hip_R',
      local: [0, -0.18, 0.14],
      euler: [1.25, Math.PI, 0.15],
      palm: [0.018, -0.04, 0.03]
    },
    // Tools that use body wrist mount when gunOnBodyMount / bodyToolsOnMount enabled
    bodyMountToolTypes: ['gun', 'hammer', 'axe', 'pickaxe', 'torch'],
    axes: {
      up: '+Y',
      forward: '+Z',
      anatomicalRight: '-X',
      note: 'With +Z forward and right-handed, anatomical right is −X. Joints *_R live at x≤0.'
    },
    poseIds: ['idle', 'walk', 'sprint', 'jump', 'fall', 'land', 'crouch', 'crouch_walk', 'use', 'swing', 'punch', 'guard', 'reload', 'flinch', 'hurt', 'limp', 'dead'],
    actions: ['idle', 'walk', 'sprint', 'jump', 'fall', 'crouch', 'use'],
    /**
     * body.on(name) catalog (ITER5). Driver/Character emit; audio/VFX/combat listen.
     * Never couple the driver to playSound / particles directly.
     */
    events: [
      { id: 'footstep', args: 'side: L|R' },
      { id: 'landed', args: 'speed: m/s' },
      { id: 'fired', args: '' },
      { id: 'reloaded', args: '' },
      { id: 'holstered', args: '' },
      { id: 'drawn', args: '' },
      { id: 'flinched', args: '' },
      { id: 'hurt', args: '' },
      { id: 'hit', args: 'zone' },
      { id: 'swung', args: '' },
      { id: 'blocked', args: 'zone' }
    ],
    /** Capsule height fractions (feet → top). Collision stays the capsule; this only classifies. */
    hitZones: [
      { id: 'legs', from: 0, to: 0.5 },
      { id: 'torso', from: 0.5, to: 0.86 },
      { id: 'head', from: 0.86, to: 1.0 }
    ],
    /** Damage multipliers by zone (gameplay owns final HP math). */
    hitMultipliers: { head: 2.0, torso: 1.0, legs: 0.75 },
    /**
     * Juice (ITER5 feel subset). Land sinks hips (1P cam inherits via head joint).
     * Sway: 1P gun arm lags look rates (lookYaw/lookPitch rad/s from Character).
     */
    feel: {
      land: { duration: 0.3, hipsSink: 0.14, kneeAdd: 1.0, hipPull: 0.5, spineAdd: 0.15, speedRef: 9 },
      bob: { walk: 0.022, sprint: 0.035 },
      sway: { yawScale: 0.04, pitchScale: 0.04, yawClamp: 0.35, pitchClamp: 0.3, follow: 7, firstPersonOnly: true }
    },
    crouchPolicy: {
      heightFactor: 0.65,
      speedFactor: 0.5,
      canJump: false,
      eyeFollowsCapsule: true,
      note: 'Done: Character.setCrouched + driver crouch/crouch_walk.'
    },
    bodyTypes: {
      normie: { height: 1.6, width: 1.0, fat: 1.0 },
      tank: { height: 1.55, width: 1.15, fat: 1.25 },
      slim: { height: 1.75, width: 0.9, fat: 0.85 }
    },
    player: { headMeshVisible: false, showArms: true, showLegs: true },
    npc: { headMeshVisible: true },
    skin: {
      palette: { skin: 0xc4a574, shirt: 0x3a5a8a, pants: 0x2a3a4a, shoe: 0x1a1a1a },
      // Limb sticks only. Torso volume = extras on hips/chest (avoids the "Y" of chest→shoulders→neck).
      segments: [
        { from: 'hips', to: 'spine', w: 0.20, d: 0.14, key: 'pants' },
        { from: 'spine', to: 'chest', w: 0.22, d: 0.15, key: 'shirt' },
        { from: 'neck', to: 'head', w: 0.09, d: 0.09, key: 'skin' },
        { from: 'shoulder_L', to: 'elbow_L', w: 0.08, d: 0.08, key: 'skin' },
        { from: 'elbow_L', to: 'wrist_L', w: 0.07, d: 0.07, key: 'skin' },
        { from: 'shoulder_R', to: 'elbow_R', w: 0.08, d: 0.08, key: 'skin' },
        { from: 'elbow_R', to: 'wrist_R', w: 0.07, d: 0.07, key: 'skin' },
        { from: 'hips', to: 'hip_L', w: 0.12, d: 0.12, key: 'pants' },
        { from: 'hip_L', to: 'knee_L', w: 0.13, d: 0.13, key: 'pants' },
        { from: 'knee_L', to: 'ankle_L', w: 0.10, d: 0.10, key: 'pants' },
        { from: 'hips', to: 'hip_R', w: 0.12, d: 0.12, key: 'pants' },
        { from: 'hip_R', to: 'knee_R', w: 0.13, d: 0.13, key: 'pants' },
        { from: 'knee_R', to: 'ankle_R', w: 0.10, d: 0.10, key: 'pants' }
      ],
      extras: [
        { joint: 'hips', size: [0.32, 0.18, 0.20], off: [0, -0.02, 0], key: 'pants' },
        // Solid torso slab (reads as chest, not three spokes from chest joint)
        { joint: 'chest', size: [0.36, 0.34, 0.20], off: [0, -0.06, 0.01], key: 'shirt' },
        // Short collar / neck stump — not a long pole
        { joint: 'neck', size: [0.11, 0.08, 0.11], off: [0, 0.02, 0], key: 'skin' },
        // Shoulder caps sitting on the torso top corners
        { joint: 'shoulder_L', size: [0.12, 0.12, 0.12], off: [0.02, 0, 0], key: 'shirt' },
        { joint: 'shoulder_R', size: [0.12, 0.12, 0.12], off: [-0.02, 0, 0], key: 'shirt' },
        { joint: 'head', size: [0.20, 0.22, 0.20], off: [0, 0.08, 0], key: 'skin', hideInPlayer: true },
        { joint: 'head', size: [0.04, 0.04, 0.05], off: [0, 0.06, 0.11], key: 'shoe', hideInPlayer: true },
        { joint: 'wrist_L', size: [0.075, 0.09, 0.075], off: [0, -0.04, 0], key: 'skin' },
        { joint: 'wrist_R', size: [0.075, 0.09, 0.075], off: [0, -0.04, 0], key: 'skin' },
        { joint: 'ankle_L', size: [0.10, 0.07, 0.24], off: [0, -0.03, 0.04], key: 'shoe' },
        { joint: 'ankle_R', size: [0.10, 0.07, 0.24], off: [0, -0.03, 0.04], key: 'shoe' }
      ]
    },
    joints: [
      { id: 'hips', parent: null, restLocal: { x: 0, y: 0.88, z: 0 } },
      { id: 'spine', parent: 'hips', restLocal: { x: 0, y: 0.12, z: 0 } },
      { id: 'chest', parent: 'spine', restLocal: { x: 0, y: 0.22, z: 0 } },
      // Short neck: was 0.22 (giraffe / Y-pole). Keep head close to clavicle line.
      { id: 'neck', parent: 'chest', restLocal: { x: 0, y: 0.10, z: 0 } },
      { id: 'head', parent: 'neck', restLocal: { x: 0, y: 0.11, z: 0 } },
      // Shoulders out to the sides on the chest, not up into a Y tip
      { id: 'shoulder_L', parent: 'chest', restLocal: { x: 0.20, y: 0.08, z: 0 } },
      { id: 'elbow_L', parent: 'shoulder_L', restLocal: { x: 0.06, y: -0.28, z: 0 } },
      { id: 'wrist_L', parent: 'elbow_L', restLocal: { x: 0.03, y: -0.26, z: 0 } },
      { id: 'shoulder_R', parent: 'chest', restLocal: { x: -0.20, y: 0.08, z: 0 } },
      { id: 'elbow_R', parent: 'shoulder_R', restLocal: { x: -0.06, y: -0.28, z: 0 } },
      { id: 'wrist_R', parent: 'elbow_R', restLocal: { x: -0.03, y: -0.26, z: 0 } },
      { id: 'hip_L', parent: 'hips', restLocal: { x: 0.09, y: -0.05, z: 0 } },
      { id: 'knee_L', parent: 'hip_L', restLocal: { x: 0, y: -0.38, z: 0 } },
      { id: 'ankle_L', parent: 'knee_L', restLocal: { x: 0, y: -0.34, z: 0 } },
      { id: 'hip_R', parent: 'hips', restLocal: { x: -0.09, y: -0.05, z: 0 } },
      { id: 'knee_R', parent: 'hip_R', restLocal: { x: 0, y: -0.38, z: 0 } },
      { id: 'ankle_R', parent: 'knee_R', restLocal: { x: 0, y: -0.34, z: 0 } }
    ],
    sockets: [
      // Past the wrist joint toward palm tip (was -0.06 into the forearm volume).
      { id: 'wrist_R', joint: 'wrist_R', name: 'toolMount', off: [0, -0.11, 0.02], rotX: Math.PI / 2 },
      { id: 'wrist_L', joint: 'wrist_L', name: 'socket_wrist_L', off: [0, -0.06, 0] },
      { id: 'back', joint: 'chest', name: 'socket_back', off: [0, 0.05, -0.12] },
      { id: 'hip_R', joint: 'hips', name: 'socket_hip_R', off: [-0.17, -0.05, 0] }
    ],
    portNotes: {
      status: 'local_done',
      freeze: 'Fase F',
      targetFiles: [
        'FPS/js/bodyRig.js',
        'FPS/js/04-character.js',
        'FPS/js/03-worlddata.js',
        'FPS/js/05-inventory.js',
        'FPS/js/12-loop.js',
        'FPS/js/17-net.js'
      ],
      newModule: 'bodyRig.js',
      mapLayers: {
        BodyRig: 'joints + restLocal + sockets',
        BodyDriver: 'poseId + overlays (use/swing/reload/flinch/hurt/limp/dead)',
        BodySkin: 'box segments + extras',
        LocomotionOwner: 'Character capsule (unchanged)',
        toolMount: 'wrist_R (+ hip_R holster for pistol)',
        netStream: 'poseId compact int 0–5 via netPoseState (not bones)',
        events: 'body.on / emit — audio/VFX/combat listen; driver stays dumb',
        hitZones: 'classifyHitOnCharacter on capsule height fractions'
      },
      localDone: [
        'NPC createBody + hit proxy',
        'Player 1P body + head camera',
        'All TOOLS on wrist_R (bodyToolsOnMount)',
        'Hold grips (not crosshair-aim shafts)',
        'Swing / reload / flinch / hurt overlays',
        'Holster pistol on hip_R',
        'Crouch capsule + poses',
        'Death crumple + corpse ballistic + VFX timing',
        'body.on events + capsule hitZones (head/torso/legs)',
        'feel: land pose + 1P gun sway + walk bob'
      ],
      doNotPort: [
        'stepCapsule (sketch)',
        'sketch AABB',
        'sketch NPC AI',
        'portal stub',
        'build-B stub',
        'ragdoll / external physics',
        '17 bone quaternions over net'
      ],
      deferred: {
        onlineBody: {
          flag: 'PLAYER_CONFIG.onlineBody',
          value: false,
          where: 'FPS/js/17-net.js netAvatar — ONLINE_BODY_PLACEHOLDER',
          steps: [
            'createBody({ mode:\"npc\" }) under remote capsule/mesh',
            'drive remote driver from r.poseId / crouch ints',
            'optional: tool/holster id in pose payload (bump carefully)',
            'keep ints 0–5 backward-compatible or document bump'
          ]
        },
        thirdPerson: {
          flag: 'PLAYER_CONFIG.thirdPerson',
          value: false,
          note: 'Body already renders in 3P as NPC. Needs cam orbit + head visible + aim retarget — cam branch, separate plan.'
        }
      },
      acceptancePort: [
        'createBody npc replaces capsule visual (hit proxy kept)',
        'Player 1P: head mesh off, camera at head joint',
        'poseId via getPoseId / data-fps-pose',
        'axes.anatomicalRight === \"-X\"',
        'capsule still owns locomotion'
      ]
    }
  };

  /**
   * Mount helpers when parenting under Character.container (origin = capsule center).
   * NPC: faceTarget atan2(dx,dz) + chase input.forward=-1 → wishDir local +Z. Body +Z → yaw 0.
   * Player: W → wishDir local −Z (camera look). Body +Z → yaw π so doll faces walk/look dir.
   */
  var BODY_MOUNT = {
    yawNpc: 0,
    yawPlayer: Math.PI,
    /** @deprecated use yawNpc / yawPlayer */
    yawPi: 0,
    feetYFromHalfHeight: function (halfHeight) { return -halfHeight; }
  };

  function createRig(params) {
    params = params || {};
    var H = params.height || REF_HEIGHT;
    var sy = H / REF_HEIGHT;
    var sx = sy * (params.width || 1);
    var joints = {};
    var order = [];
    BODY_DEF.joints.forEach(function (d) {
      var node = new THREE.Object3D();
      node.name = d.id;
      node.position.set(d.restLocal.x * sx, d.restLocal.y * sy, d.restLocal.z * sy);
      var j = { id: d.id, parent: d.parent, restLocal: node.position.clone(), node: node };
      joints[d.id] = j;
      order.push(j);
    });
    order.forEach(function (j) {
      if (j.parent) joints[j.parent].node.add(j.node);
    });
    var restPose = {};
    order.forEach(function (j) { restPose[j.id] = j.restLocal.clone(); });
    return {
      joints: joints,
      order: order,
      root: joints.hips.node,
      restPose: restPose,
      params: { H: H, sx: sx, sy: sy, fat: params.fat || 1 },
      getJoint: function (id) { return joints[id]; },
      foreachJoint: function (fn) { order.forEach(fn); }
    };
  }

  function createSkin(rig, mode, palette) {
    var P = rig.params;
    var mats = {};
    var items = [];
    var geoms = [];
    ['skin', 'shirt', 'pants', 'shoe'].forEach(function (k) {
      mats[k] = new THREE.MeshStandardMaterial({
        color: palette[k],
        flatShading: true,
        roughness: 0.9,
        metalness: 0.02
      });
    });
    function add(joint, w, h, d, off, quat, key, hide) {
      var g = new THREE.BoxGeometry(w, h, d);
      geoms.push(g);
      var m = new THREE.Mesh(g, mats[key]);
      m.position.copy(off);
      if (quat) m.quaternion.copy(quat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.raycast = function () {}; // skin does not steal bullet rays; hit proxy does
      joint.node.add(m);
      items.push({ mesh: m, hideInPlayer: !!hide });
    }
    BODY_DEF.skin.segments.forEach(function (s) {
      var c = rig.joints[s.to].restLocal;
      var len = c.length();
      add(
        rig.joints[s.from],
        s.w * P.sx * P.fat,
        len,
        s.d * P.sy * P.fat,
        c.clone().multiplyScalar(0.5),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().normalize()),
        s.key,
        s.hideInPlayer
      );
    });
    BODY_DEF.skin.extras.forEach(function (e) {
      add(
        rig.joints[e.joint],
        e.size[0] * P.sx * P.fat,
        e.size[1] * P.sy,
        e.size[2] * P.sy * P.fat,
        new THREE.Vector3(e.off[0] * P.sx, e.off[1] * P.sy, e.off[2] * P.sy),
        null,
        e.key,
        e.hideInPlayer
      );
    });
    function setMode(m) {
      var showHead = m === 'player' ? BODY_DEF.player.headMeshVisible : BODY_DEF.npc.headMeshVisible;
      items.forEach(function (it) {
        it.mesh.visible = it.hideInPlayer ? showHead : true;
      });
    }
    setMode(mode);
    return {
      meshes: items,
      setMode: setMode,
      dispose: function () {
        geoms.forEach(function (g) { g.dispose(); });
        Object.keys(mats).forEach(function (k) { mats[k].dispose(); });
      }
    };
  }

  function createDriver(rig) {
    var hipsRest = rig.restPose.hips.y;
    var hipOff = Math.abs(rig.restPose.hip_L.y);
    var L1 = Math.abs(rig.restPose.knee_L.y);
    var L2 = Math.abs(rig.restPose.ankle_L.y);
    var ankleH = hipsRest - hipOff - L1 - L2;
    var CA = 1.35;
    var CK = 2.4;
    var crouchHipsY = ankleH + hipOff + L1 * Math.cos(CA) + L2 * Math.cos(CA - CK);
    var d = {
      action: 'idle',
      poseId: 'idle',
      baseId: 'idle',
      phase: 0,
      useT: 0,
      useW: 0,
      swingT: 0,
      swingW: 0,
      swingDur: 0.42,
      punchT: 0,
      punchW: 0,
      punchDur: 0.28,
      punchSide: 1,
      guardOn: false,
      guardW: 0,
      _guardWrist: false,
      _guardWristAmt: 0,
      _guardFp: false,
      reloadT: 0,
      flinchT: 0,
      hurtT: 0,
      deathT: 0,
      landT: 0,
      landAmt: 0,
      swX: 0,
      swP: 0,
      hitSide: 1,
      forced: null,
      pose: {},
      lastStepSign: true,
      _prevReloadT: 0,
      _prevFlinchT: 0,
      _prevHurtT: 0,
      onEvent: null
    };

    function ev(name, arg) {
      if (typeof d.onEvent === 'function') {
        try { d.onEvent(name, arg); } catch (e) {}
      }
    }

    var feelLand = (BODY_DEF.feel && BODY_DEF.feel.land) || {};
    var landDur = feelLand.duration != null ? feelLand.duration : 0.3;
    var landSpeedRef = feelLand.speedRef != null ? feelLand.speedRef : 9;

    d.setAction = function (name) {
      if (name === 'use') { d.useT = 0.35; return; }
      if (name === 'swing') { d.swingT = d.swingDur || 0.42; return; }
      if (name === 'punch') { d.punchT = d.punchDur || 0.28; return; }
      if (name === 'reload') { d.reloadT = 0.85; return; }
      if (name === 'flinch') { d.flinchT = 0.38; return; }
      if (name === 'hurt') { d.hurtT = Math.max(d.hurtT, 1.2); return; }
      if (BODY_DEF.actions.indexOf(name) < 0) return;
      d.forced = name;
    };

    d.land = function (speed) {
      var spd = Math.abs(speed || 0);
      d.landT = landDur;
      d.landAmt = Math.min(1, spd / landSpeedRef);
    };

    d.playSwing = function (opts) {
      opts = opts || {};
      var dur = (opts.duration != null && opts.duration > 0.1) ? opts.duration : 0.42;
      d.swingDur = dur;
      d.swingT = dur;
      if (opts.side != null) d.hitSide = opts.side;
      ev('swung');
    };

    d.playPunch = function (opts) {
      opts = opts || {};
      var dur = (opts.duration != null && opts.duration > 0.08) ? opts.duration : 0.28;
      d.punchDur = dur;
      d.punchT = dur;
      d.punchSide = opts.side != null ? opts.side : 1;
      d.hitSide = d.punchSide;
      ev('swung');
    };

    d.setGuard = function (on) {
      d.guardOn = !!on;
    };

    d.playHit = function (opts) {
      opts = opts || {};
      d.hitSide = opts.side != null ? opts.side : (Math.random() < 0.5 ? -1 : 1);
      var wasFlinch = d.flinchT <= 0;
      d.flinchT = opts.heavy ? 0.55 : 0.38;
      if (wasFlinch) ev('overlay', 'flinch');
      if (opts.heavy) {
        var wasHurt = d.hurtT <= 0.15;
        d.hurtT = Math.max(d.hurtT, 1.6);
        if (wasHurt) ev('overlay', 'hurt');
      } else if (d.hurtT < 0.4) {
        d.hurtT = 0.85;
      }
    };

    d.playDeath = function () {
      d.deathT = 0.001;
      d.flinchT = 0;
      d.hurtT = 0;
      d.useT = 0;
    };

    d.update = function (dt, fl) {
      fl = fl || {};
      var a = d.forced;
      d.forced = null;
      if (!a) {
        if (!fl.onGround) a = (fl.velY > 0.3) ? 'jump' : 'fall';
        else if (fl.crouched) a = 'crouch';
        else if (fl.moving) a = fl.sprint ? 'sprint' : 'walk';
        else a = 'idle';
      }
      d.action = a;
      d.baseId = (a === 'crouch' && fl.moving) ? 'crouch_walk' : a;

      var prevReload = d.reloadT;
      var prevFlinch = d.flinchT;
      var prevHurt = d.hurtT;

      if (fl.guarding) d.guardOn = true;
      else if (fl.guarding === false) d.guardOn = false;

      if (d.useT > 0) d.useT -= dt;
      if (d.swingT > 0) d.swingT -= dt;
      if (d.punchT > 0) d.punchT -= dt;
      if (d.reloadT > 0) d.reloadT -= dt;
      if (d.flinchT > 0) d.flinchT -= dt;
      if (d.hurtT > 0) d.hurtT -= dt;
      if (d.landT > 0) d.landT -= dt;
      if (d.deathT > 0) d.deathT += dt;
      d.useW += ((d.useT > 0 ? 1 : 0) - d.useW) * Math.min(1, dt * 18);
      d.swingW += ((d.swingT > 0 ? 1 : 0) - d.swingW) * Math.min(1, dt * 16);
      d.punchW += ((d.punchT > 0 ? 1 : 0) - d.punchW) * Math.min(1, dt * 18);
      // Snappier raise into guard so 1P muro appears on RMB hold
      d.guardW += (((d.guardOn || fl.guarding) ? 1 : 0) - d.guardW) * Math.min(1, dt * 20);

      if (prevReload > 0 && d.reloadT <= 0) ev('reloaded');
      if (prevFlinch <= 0 && d.flinchT > 0) ev('overlay', 'flinch');
      if (prevHurt <= 0.15 && d.hurtT > 0.15) ev('overlay', 'hurt');

      // Dominant poseId (overlays beat locomotion)
      if (fl.down === 'dead' || d.deathT > 0.55) d.poseId = 'dead';
      else if (fl.down === 'limp' || (d.deathT > 0 && d.deathT <= 0.55)) d.poseId = 'limp';
      else if (d.flinchT > 0) d.poseId = 'flinch';
      else if (d.hurtT > 0.15) d.poseId = 'hurt';
      // Guard outranks leftover punch when actively blocking
      else if ((d.guardOn || fl.guarding || d.guardW > 0.35) && d.punchT <= 0.05) d.poseId = 'guard';
      else if (d.punchT > 0) d.poseId = 'punch';
      else if (d.swingT > 0) d.poseId = 'swing';
      else if (d.reloadT > 0) d.poseId = 'reload';
      else if (d.useT > 0) d.poseId = 'use';
      else if (d.guardW > 0.35 || d.guardOn || fl.guarding) d.poseId = 'guard';
      else if (d.landT > 0) d.poseId = 'land';
      else d.poseId = d.baseId;

      if (fl.down === 'dead' || fl.down === 'limp') {
        d.action = d.baseId = fl.down;
      }

      var sp = fl.speedH || 0;
      var moveAmt = Math.min(1, sp / 3);
      d.phase += dt * Math.min(16, sp * 1.6 + (fl.moving ? 4 : 0));
      if (fl.onGround && fl.moving && !(fl.down === 'dead' || fl.down === 'limp')) {
        var sgn = Math.sin(d.phase) >= 0;
        if (sgn !== d.lastStepSign) {
          d.lastStepSign = sgn;
          ev('footstep', sgn ? 'L' : 'R');
        }
      }
      var sw = Math.sin(d.phase);
      var cw = Math.cos(d.phase);
      var t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      var P = {};
      var hipsY = hipsRest;
      var blendK = 14;

      var amp = 0;
      if (fl.onGround && fl.moving && d.flinchT <= 0 && d.deathT <= 0) {
        amp = (a === 'sprint' ? 0.85 : (a === 'crouch' ? 0.28 : 0.6)) * Math.max(moveAmt, 0.35);
      }
      var swing = sw * amp;

      var hipL = swing, hipR = -swing;
      var kneeL = Math.max(0, -cw) * amp * 1.1;
      var kneeR = Math.max(0, cw) * amp * 1.1;
      var spineX = a === 'sprint' ? 0.18 : 0;
      var headX = 0;
      var am = fl.fp ? 1.0 : 0.7;
      var shL = [-1.1 - swing * am, 0, 0];
      var elL = -0.55 - (fl.fp ? Math.abs(swing) * 0.25 : 0);
      var shR = fl.hasGun ? [-1.1 + Math.sin(d.phase * 2) * amp * 0.07, 0, 0] : [-1.1 + swing * am, 0, 0];
      var elR = -0.55;

      if (a === 'idle') {
        P.chest = [Math.sin(t * 1.6) * 0.02, 0, 0];
        if (fl.fp) { hipL = -0.15; kneeL = 0.12; hipR = 0.08; }
      }
      if (a === 'crouch') {
        hipsY = crouchHipsY;
        spineX = 0.35;
        headX = -0.3;
        hipL = -CA + swing * 0.4;
        hipR = -CA - swing * 0.4;
        kneeL = CK;
        kneeR = CK;
      }
      if (a === 'jump') {
        hipL = -0.5; kneeL = 0.9; hipR = -0.1; kneeR = 0.3;
        shL = [-0.3, 0, 0.5];
        if (!fl.hasGun) shR = [-0.3, 0, -0.5];
      }
      if (a === 'fall') {
        hipL = -0.2; kneeL = 0.3; hipR = 0.15; kneeR = 0.1;
        shL = [-0.2, 0, 0.8];
        if (!fl.hasGun) shR = [-0.2, 0, -0.8];
      }

      // Walk bob (head cam inherits) + land squash
      var sy = rig.params.sy || 1;
      var feelBob = (BODY_DEF.feel && BODY_DEF.feel.bob) || {};
      if (fl.onGround && fl.moving && d.deathT <= 0 && (a === 'walk' || a === 'sprint' || a === 'crouch')) {
        var bobAmp = (a === 'sprint'
          ? (feelBob.sprint != null ? feelBob.sprint : 0.035)
          : (feelBob.walk != null ? feelBob.walk : 0.022));
        hipsY += Math.abs(sw) * bobAmp * sy * Math.max(moveAmt, 0.35);
      }
      var lj = 0;
      if (d.landT > 0 && d.deathT <= 0) {
        lj = Math.sin(Math.PI * (1 - Math.max(0, d.landT) / landDur)) * d.landAmt;
        var sink = feelLand.hipsSink != null ? feelLand.hipsSink : 0.14;
        var kneeAdd = feelLand.kneeAdd != null ? feelLand.kneeAdd : 1.0;
        var hipPull = feelLand.hipPull != null ? feelLand.hipPull : 0.5;
        var spineAdd = feelLand.spineAdd != null ? feelLand.spineAdd : 0.15;
        hipsY -= sink * lj * sy;
        kneeL += kneeAdd * lj;
        kneeR += kneeAdd * lj;
        hipL -= hipPull * lj;
        hipR -= hipPull * lj;
        spineX += spineAdd * lj;
      }

      // Soft arm bias toward look (subtle — tool mesh has its own hold pose).
      var aimP = Math.max(-0.9, Math.min(1.0, fl.pitch || 0));
      if (fl.hasGun && d.deathT <= 0 && d.flinchT <= 0) {
        var aimHold = fl.fp ? 0.22 : 0.12;
        var aimX = -(Math.PI / 2 + aimP * 0.35 + 0.08);
        shR = [
          shR[0] * (1 - aimHold) + aimX * aimHold,
          shR[1],
          shR[2] * (1 - aimHold)
        ];
        elR = elR * (1 - aimHold) + (-0.12) * aimHold;
      }
      var w = d.useW;
      var recoil = Math.max(0, d.useT - 0.2) / 0.15 * 0.22;
      shR = [shR[0] * (1 - w) + (-(Math.PI / 2 + aimP * 0.5 + 0.12)) * w - recoil * w, shR[1] * (1 - w), shR[2] * (1 - w)];
      elR = elR * (1 - w) + (-0.08) * w;

      // 1P gun sway: arm lags look rates (rad/s)
      var feelSway = (BODY_DEF.feel && BODY_DEF.feel.sway) || {};
      var swayFpOnly = feelSway.firstPersonOnly !== false;
      if (fl.hasGun && d.deathT <= 0 && d.flinchT <= 0 && (!swayFpOnly || fl.fp)) {
        var yScale = feelSway.yawScale != null ? feelSway.yawScale : 0.04;
        var pScale = feelSway.pitchScale != null ? feelSway.pitchScale : 0.04;
        var yClamp = feelSway.yawClamp != null ? feelSway.yawClamp : 0.35;
        var pClamp = feelSway.pitchClamp != null ? feelSway.pitchClamp : 0.3;
        var follow = feelSway.follow != null ? feelSway.follow : 7;
        var tgtX = Math.max(-yClamp, Math.min(yClamp, -(fl.lookYaw || 0) * yScale));
        var tgtP = Math.max(-pClamp, Math.min(pClamp, (fl.lookPitch || 0) * pScale));
        var sk = Math.min(1, dt * follow);
        d.swX += (tgtX - d.swX) * sk;
        d.swP += (tgtP - d.swP) * sk;
        var damp = 1 - w;
        shR = [shR[0] + d.swP * damp, shR[1] + d.swX * damp, shR[2]];
      } else {
        d.swX *= Math.max(0, 1 - dt * 8);
        d.swP *= Math.max(0, 1 - dt * 8);
      }

      // Melee/harvest swing: wind-up → strike (right arm arc). Uses swingW for blend.
      var swg = d.swingW;
      if (swg > 0.01) {
        var sDur = d.swingDur > 0.1 ? d.swingDur : 0.42;
        var strike = d.swingT > 0 ? (1 - Math.min(1, d.swingT / sDur)) : 1; // 0 wind → 1 end
        var wind = Math.sin(Math.min(1, strike) * Math.PI); // peaks mid-swing
        var shSwing = [-0.2 - wind * 1.4, -0.15 * wind, 0.55 * wind];
        var elSwing = [-0.2 - wind * 1.1, 0, 0.25 * wind];
        shR = [
          shR[0] * (1 - swg) + shSwing[0] * swg,
          shR[1] * (1 - swg) + shSwing[1] * swg,
          shR[2] * (1 - swg) + shSwing[2] * swg
        ];
        elR = elR * (1 - swg) + elSwing[0] * swg;
        spineX = spineX + 0.12 * wind * swg;
        shL = [shL[0] * (1 - 0.4 * swg) + (-0.5) * 0.4 * swg, shL[1], shL[2]];
      }

      // Fists punch: alternate arm extends forward (peaks mid). side +1 = R, -1 = L
      var pw = d.punchW;
      if (pw > 0.01) {
        var pDur = d.punchDur > 0.08 ? d.punchDur : 0.28;
        var pProg = d.punchT > 0 ? (1 - Math.min(1, d.punchT / pDur)) : 1;
        var pWind = Math.sin(Math.min(1, pProg) * Math.PI);
        var side = d.punchSide >= 0 ? 1 : -1;
        var shPunch = [-0.15 - pWind * 1.55, side * 0.05 * pWind, -side * 0.35 * pWind];
        var elPunch = -0.15 - pWind * 0.95;
        if (side > 0) {
          shR = [
            shR[0] * (1 - pw) + shPunch[0] * pw,
            shR[1] * (1 - pw) + shPunch[1] * pw,
            shR[2] * (1 - pw) + shPunch[2] * pw
          ];
          elR = elR * (1 - pw) + elPunch * pw;
          shL = [shL[0] * (1 - 0.35 * pw) + (-0.85) * 0.35 * pw, shL[1], shL[2]];
        } else {
          shL = [
            shL[0] * (1 - pw) + shPunch[0] * pw,
            shL[1] * (1 - pw) + (-shPunch[1]) * pw,
            shL[2] * (1 - pw) + (-shPunch[2]) * pw
          ];
          elL = elL * (1 - pw) + elPunch * pw;
          shR = [shR[0] * (1 - 0.35 * pw) + (-0.85) * 0.35 * pw, shR[1], shR[2]];
        }
        spineX = spineX + 0.1 * pWind * pw;
      }

      // Guard / block (future shield): fists close, wall in front of face/camera
      var gw = d.guardW;
      if (gw > 0.01) {
        // z≈0 = no flare. y = yaw inward toward midline.
        // 1P: elbows less folded so fists sit as a muro in the near FOV.
        // 3P/NPC: tighter fold — fists readable on the cheeks.
        var fpG = !!fl.fp;
        var shGuardL = fpG ? [-2.15, -0.72, 0.04] : [-2.00, -0.48, 0.10];
        var shGuardR = fpG ? [-2.15, 0.72, -0.04] : [-2.00, 0.48, -0.10];
        var elGuard = fpG ? -1.18 : -1.72;
        shL = [
          shL[0] * (1 - gw) + shGuardL[0] * gw,
          shL[1] * (1 - gw) + shGuardL[1] * gw,
          shL[2] * (1 - gw) + shGuardL[2] * gw
        ];
        shR = [
          shR[0] * (1 - gw) + shGuardR[0] * gw,
          shR[1] * (1 - gw) + shGuardR[1] * gw,
          shR[2] * (1 - gw) + shGuardR[2] * gw
        ];
        elL = elL * (1 - gw) + elGuard * gw;
        elR = elR * (1 - gw) + elGuard * gw;
        // Semi-crouch (≈45% of full crouch) — planted boxing stance
        var gCrouch = 0.45 * gw;
        hipsY = hipsY * (1 - gCrouch) + crouchHipsY * gCrouch;
        hipL = hipL * (1 - gCrouch) + (-CA * 0.55) * gCrouch;
        hipR = hipR * (1 - gCrouch) + (-CA * 0.55) * gCrouch;
        kneeL = kneeL * (1 - gCrouch) + (CK * 0.5) * gCrouch;
        kneeR = kneeR * (1 - gCrouch) + (CK * 0.5) * gCrouch;
        spineX = spineX * (1 - gw) + 0.32 * gw;
        headX = headX * (1 - gw) + (-0.18) * gw;
        // Curl wrists so knuckles face the threat / fill FOV
        d._guardWrist = true;
        d._guardWristAmt = gw;
        d._guardFp = fpG;
      } else {
        d._guardWrist = false;
        d._guardWristAmt = 0;
      }

      // Reload: gun toward chest / mag well (simple stub)
      if (d.reloadT > 0) {
        var rw = Math.min(1, d.reloadT / 0.4);
        shR = [-1.0 * rw + shR[0] * (1 - rw), 0.35 * rw, 0.25 * rw];
        elR = -1.2 * rw + elR * (1 - rw);
        shL = [-0.9 * rw + shL[0] * (1 - rw), -0.2 * rw, 0.4 * rw];
        elL = -1.0 * rw + elL * (1 - rw);
      }

      P.hips = [0, 0, 0];
      P.spine = [spineX, 0, 0];
      P.chest = P.chest || [spineX * 0.3, 0, 0];
      P.neck = [-(fl.pitch || 0) * 0.2, 0, 0];
      P.head = [-(fl.pitch || 0) * 0.5 + headX, 0, 0];
      P.shoulder_L = shL;
      P.elbow_L = [elL, 0, 0];
      P.shoulder_R = shR;
      P.elbow_R = [elR, 0, 0];
      P.hip_L = [hipL, 0, 0];
      P.knee_L = [kneeL, 0, 0];
      P.hip_R = [hipR, 0, 0];
      P.knee_R = [kneeR, 0, 0];
      P.ankle_L = [-(hipL + kneeL), 0, 0];
      P.ankle_R = [-(hipR + kneeR), 0, 0];
      // Guard: knuckle wall — wrists tip fists into the look / toward center
      if (d._guardWrist && d._guardWristAmt > 0.01) {
        var wa = d._guardWristAmt;
        var wFwd = d._guardFp ? 0.55 : 0.25;
        var wIn = d._guardFp ? 0.85 : 0.45;
        P.wrist_L = [wFwd * wa, 0, wIn * wa];
        P.wrist_R = [wFwd * wa, 0, -wIn * wa];
      }

      // Hurt idle: hand to ribs, limp lean
      if (d.hurtT > 0 && d.flinchT <= 0 && d.deathT <= 0 && !fl.down) {
        var hw = Math.min(1, d.hurtT);
        P.spine = [0.22 * hw, 0.08 * d.hitSide * hw, 0];
        P.chest = [0.12 * hw, 0.05 * d.hitSide * hw, 0];
        P.head = [0.15 * hw, -0.1 * d.hitSide * hw, 0];
        P.shoulder_L = [-0.4, 0, 0.35 * hw];
        P.elbow_L = [-1.1 * hw, 0, 0.2];
        if (!fl.hasGun) {
          P.shoulder_R = [-0.9 * hw, 0, -0.2 * d.hitSide];
          P.elbow_R = [-0.8 * hw, 0, 0];
        }
        P.hip_L = [hipL - 0.15 * hw, 0, 0];
        P.knee_L = [kneeL + 0.2 * hw, 0, 0];
      }

      // Flinch: snap lean away from hit
      if (d.flinchT > 0 && d.deathT <= 0) {
        var fw = Math.min(1, d.flinchT / 0.2);
        var side = d.hitSide || 1;
        P.spine = [-0.35 * fw, 0.45 * side * fw, 0];
        P.chest = [-0.2 * fw, 0.25 * side * fw, 0];
        P.head = [-0.4 * fw, -0.35 * side * fw, 0.1 * side];
        P.shoulder_L = [0.2 * fw, 0, 0.5 * fw];
        P.shoulder_R = [0.2 * fw, 0, -0.5 * fw];
        P.hip_L = [-0.35 * fw, 0, 0.1 * side];
        P.hip_R = [-0.15 * fw, 0, -0.1 * side];
        P.knee_L = [0.7 * fw, 0, 0];
        P.knee_R = [0.4 * fw, 0, 0];
        blendK = 22;
      }

      // Staged death: limp crumple → flat dead (procedural “ragdoll” feel, no physics engine)
      if (d.deathT > 0 || fl.down === 'limp' || fl.down === 'dead') {
        var dtDeath = d.deathT || (fl.down === 'dead' ? 1 : 0.3);
        var crumple = Math.min(1, dtDeath / 0.5);
        var flat = Math.max(0, Math.min(1, (dtDeath - 0.45) / 0.4));
        blendK = 10;
        P = {};
        hipsY = (hipOff + L1 + 0.04 * rig.params.sy) * (1 - flat) + (0.12 * rig.params.sy) * flat;
        P.hips = [-0.9 * crumple - 0.65 * flat, 0.2 * d.hitSide * (1 - flat), 0.15 * d.hitSide * flat];
        P.spine = [0.75 * crumple, 0.1 * d.hitSide, 0];
        P.chest = [0.35 * crumple, 0, 0];
        P.neck = [0.35 * crumple, 0, 0];
        P.head = [0.6 * crumple, 0.2 * d.hitSide, 0];
        P.shoulder_L = [0.15, 0, 0.55 * crumple + 0.2];
        P.shoulder_R = [0.15, 0, -0.55 * crumple - 0.2];
        P.elbow_L = [-0.3, 0, 0];
        P.elbow_R = [-0.3, 0, 0];
        P.hip_L = [0.2 * crumple, 0, 0.12];
        P.hip_R = [0.35 * crumple, 0, -0.12];
        P.knee_L = [1.2 * crumple + 0.3 * flat, 0, 0];
        P.knee_R = [1.35 * crumple + 0.2 * flat, 0, 0];
        P.ankle_L = [-0.5, 0, 0];
        P.ankle_R = [-0.4, 0, 0];
      }

      d.pose = P;

      var k = 1 - Math.exp(-blendK * dt);
      rig.foreachJoint(function (j) {
        var tg = P[j.id] || [0, 0, 0];
        var r = j.node.rotation;
        r.x += (tg[0] - r.x) * k;
        r.y += (tg[1] - r.y) * k;
        r.z += (tg[2] - r.z) * k;
      });
      var hn = rig.joints.hips.node;
      hn.position.y += (hipsY - hn.position.y) * k;
      return a;
    };

    return d;
  }

  /**
   * Visual-only body. Caller parents `root` under Character.container and calls update each frame.
   * options: {
   *   mode: 'player'|'npc',
   *   bodyTypeId?: 'normie'|'tank'|'slim',
   *   bodyType?: {height,width,fat},
   *   palette?: {skin,shirt,pants,shoe},
   *   showGunStub?: boolean (default false),
   *   mountOnCharacter?: boolean (default true),
   *   mountYaw?: number (override; else yawPlayer / yawNpc by mode)
   * }
   */
  function createBody(opt) {
    opt = opt || {};
    var mode = opt.mode === 'player' ? 'player' : 'npc';
    var bt = opt.bodyType || BODY_DEF.bodyTypes[opt.bodyTypeId] || BODY_DEF.bodyTypes.normie;
    var rig = createRig(bt);
    var palette = Object.assign({}, BODY_DEF.skin.palette, opt.palette || {});
    var skin = createSkin(rig, mode, palette);
    var driver = createDriver(rig);

    var root = new THREE.Group();
    root.name = 'body_' + mode;
    root.add(rig.root);
    if (opt.mountOnCharacter !== false) {
      var yaw = (typeof opt.mountYaw === 'number')
        ? opt.mountYaw
        : (mode === 'player' ? BODY_MOUNT.yawPlayer : BODY_MOUNT.yawNpc);
      root.rotation.y = yaw;
    }

    var sockets = {};
    BODY_DEF.sockets.forEach(function (sd) {
      var o = new THREE.Object3D();
      o.name = sd.name;
      o.position.set(sd.off[0] * rig.params.sx, sd.off[1] * rig.params.sy, sd.off[2] * rig.params.sy);
      if (sd.rotX) o.rotation.x = sd.rotX;
      rig.getJoint(sd.joint).node.add(o);
      sockets[sd.id] = o;
    });
    var toolMount = sockets.wrist_R;

    var gunMat = null;
    var barrel = null;
    var grip = null;
    if (opt.showGunStub) {
      gunMat = new THREE.MeshStandardMaterial({ color: 0x2b2d33, flatShading: true, metalness: 0.6, roughness: 0.4 });
      barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.22), gunMat);
      barrel.position.set(0, 0, 0.11);
      grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 0.05), gunMat);
      grip.position.set(0, -0.07, 0.02);
      barrel.raycast = function () {};
      grip.raycast = function () {};
      toolMount.add(barrel, grip);
    }

    var headJoint = rig.getJoint('head').node;
    var _flashT = 0;
    var _baseColors = [];
    skin.meshes.forEach(function (it) {
      if (it.mesh && it.mesh.material && it.mesh.material.color) {
        _baseColors.push({ mat: it.mesh.material, hex: it.mesh.material.color.getHex() });
      }
    });

    var listeners = {};
    function emit(name, arg) {
      var list = listeners[name];
      if (!list || !list.length) return;
      for (var i = 0; i < list.length; i++) {
        try { list[i](arg, body); } catch (e) {}
      }
    }

    driver.onEvent = function (name, arg) {
      if (name === 'footstep') emit('footstep', arg);
      else if (name === 'reloaded') emit('reloaded', arg);
      else if (name === 'swung') emit('swung', arg);
      else if (name === 'overlay') {
        if (arg === 'flinch') emit('flinched');
        else if (arg === 'hurt') emit('hurt');
      } else if (name === 'use') {
        emit('fired');
      }
    };

    var body = {
      mode: mode,
      root: root,
      rig: rig,
      driver: driver,
      skin: skin,
      toolMount: toolMount,
      sockets: sockets,
      headJoint: headJoint,
      bodyTypeId: opt.bodyTypeId || 'normie',
      down: null,
      emit: emit,
      on: function (name, fn) {
        if (!name || typeof fn !== 'function') return;
        (listeners[name] = listeners[name] || []).push(fn);
      },
      off: function (name, fn) {
        var list = listeners[name];
        if (!list) return;
        if (!fn) { listeners[name] = []; return; }
        var i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      },
      setDown: function (kind) {
        body.down = kind || null;
        if (kind === 'dead' || kind === 'limp') driver.playDeath();
      },
      setAction: function (name) {
        driver.setAction(name);
      },
      playHit: function (opts) {
        driver.playHit(opts || {});
        body.flashHit(opts && opts.heavy ? 0.28 : 0.16);
      },
      playSwing: function (opts) {
        if (typeof driver.playSwing === 'function') driver.playSwing(opts || {});
        else {
          driver.setAction('swing');
          emit('swung');
        }
      },
      playPunch: function (opts) {
        if (typeof driver.playPunch === 'function') driver.playPunch(opts || {});
        else if (typeof driver.playSwing === 'function') driver.playSwing(opts || {});
      },
      setGuard: function (on) {
        if (typeof driver.setGuard === 'function') driver.setGuard(!!on);
      },
      playLand: function (speed) {
        if (typeof driver.land === 'function') driver.land(speed);
      },
      playReload: function () {
        driver.setAction('reload');
      },
      playDeath: function () {
        body.down = 'dead';
        driver.playDeath();
        body.flashHit(0.45);
      },
      flashHit: function (sec) {
        _flashT = Math.max(_flashT, sec || 0.18);
        _baseColors.forEach(function (c) {
          c.mat.emissive = c.mat.emissive || new THREE.Color(0x000000);
          c.mat.emissive.setHex(0xaa2200);
          c.mat.emissiveIntensity = 0.85;
        });
      },
      getPoseId: function () {
        return driver.poseId;
      },
      /**
       * flags: { moving, onGround, crouched, sprint, velY, speedH, pitch, hasGun, fp, down }
       * No locomotion — Character owns that.
       */
      update: function (dt, flags) {
        flags = flags || {};
        if (body.down) flags = Object.assign({}, flags, { down: body.down });
        driver.update(dt, flags);
        if (_flashT > 0) {
          _flashT -= dt;
          if (_flashT <= 0) {
            _baseColors.forEach(function (c) {
              c.mat.color.setHex(c.hex);
              if (c.mat.emissive) {
                c.mat.emissive.setHex(0x000000);
                c.mat.emissiveIntensity = 0;
              }
            });
          }
        }
      },
      dispose: function () {
        listeners = {};
        if (root.parent) root.parent.remove(root);
        skin.dispose();
        if (gunMat) gunMat.dispose();
        if (barrel) barrel.geometry.dispose();
        if (grip) grip.geometry.dispose();
      }
    };
    return body;
  }

  /**
   * Classify a world-Y hit on a vertical capsule span (feetY .. feetY+height).
   * Returns zone id: 'head' | 'torso' | 'legs' (default torso).
   */
  function classifyHitHeight(feetY, height, worldY) {
    var h = height > 1e-6 ? height : 1.6;
    var f = (worldY - feetY) / h;
    var Z = BODY_DEF.hitZones || [];
    for (var i = 0; i < Z.length; i++) {
      if (f >= Z[i].from && f <= Z[i].to) return Z[i].id;
    }
    if (f > 1) return 'head';
    if (f < 0) return 'legs';
    return 'torso';
  }

  /** Character-like: uses container.position.y and halfHeight/height. */
  function classifyHitOnCharacter(character, worldY) {
    if (!character || worldY == null || !isFinite(worldY)) return 'torso';
    var height = character.height || (character.config && character.config.height) || 1.6;
    var half = character.halfHeight != null ? character.halfHeight : height * 0.5;
    var cy = (character.container && character.container.position)
      ? character.container.position.y
      : 0;
    var feetY = cy - half;
    return classifyHitHeight(feetY, height, worldY);
  }

  function hitZoneMultiplier(zone) {
    var m = BODY_DEF.hitMultipliers || {};
    if (zone && m[zone] != null) return m[zone];
    return 1;
  }

  /** Apply zone multiplier to base damage. */
  function scaleDamageByHit(baseDamage, character, worldY) {
    var zone = classifyHitOnCharacter(character, worldY);
    var mult = hitZoneMultiplier(zone);
    return { damage: Math.max(1, Math.round(baseDamage * mult)), zone: zone, mult: mult };
  }

  function bodySelfCheck() {
    var ok = BODY_DEF.axes.anatomicalRight === '-X' && BODY_DEF.joints.length === 17;
    BODY_DEF.joints.forEach(function (j) {
      if (j.id.slice(-2) === '_R' && j.restLocal.x > 0) ok = false;
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dataset.fpsBody = ok ? 'ok' : 'warn';
      document.documentElement.dataset.fpsBodyJoints = String(BODY_DEF.joints.length);
    }
    if (!ok) console.warn('[bodyRig] self-check warn');
    else console.log('[bodyRig] self-check ok · joints=' + BODY_DEF.joints.length);
    return ok;
  }

  /** Scale factor when mounting an ITEM_DEFINITIONS viewmodel onto a body socket. */
  function getViewmodelWorldScale(itemId) {
    var sc = BODY_DEF.scale || {};
    if (itemId && sc.items && sc.items[itemId] != null) return sc.items[itemId];
    if (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.viewmodelToWorld != null) {
      return PLAYER_CONFIG.viewmodelToWorld;
    }
    return sc.viewmodelToWorld != null ? sc.viewmodelToWorld : 0.32;
  }

  global.BODY_DEF = BODY_DEF;
  global.BODY_MOUNT = BODY_MOUNT;
  global.createBody = createBody;
  global.createRig = createRig;
  global.bodySelfCheck = bodySelfCheck;
  global.getViewmodelWorldScale = getViewmodelWorldScale;
  global.classifyHitHeight = classifyHitHeight;
  global.classifyHitOnCharacter = classifyHitOnCharacter;
  global.hitZoneMultiplier = hitZoneMultiplier;
  global.scaleDamageByHit = scaleDamageByHit;

  try { bodySelfCheck(); } catch (e) { console.warn('[bodyRig] self-check error', e); }
})(typeof window !== 'undefined' ? window : this);
