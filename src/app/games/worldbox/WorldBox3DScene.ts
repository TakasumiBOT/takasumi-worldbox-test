import * as THREE from "three";
import {
  MAP_SEED,
  T_DIRT,
  T_GRASS,
  T_ROCK,
  T_SAND,
  T_SNOW,
  T_SNOW_TREE,
  T_TREE,
  T_WATER,
  tileIvsAt,
} from "@/lib/worldbox/world/mapgen";
import {
  L_CARPET,
  L_CHECK,
  L_CONCRETE,
  L_DARK,
  L_MARBLE,
  L_PLAZA,
  L_RING,
  L_SAND,
  L_VOID,
  L_WALL,
  L_WOOD,
  type LobbyData,
} from "@/lib/worldbox/world/lobby";
import {
  evaluateCitizenPose,
  settlementSurfaceAt,
  settlementsNear,
  type Settlement,
} from "@/lib/worldbox/world/settlements";
import type { SettlementInteriorSpec } from "@/lib/worldbox/world/settlement-interiors";
import { vehicleSpecFor, type VehicleItemId } from "@/lib/worldbox/player/vehicles";
import { isOverrideActive, tileKey, type TileOverridesMap } from "@/lib/worldbox/world/tiles";
import type { MapPin, TrackedTarget } from "@/lib/worldbox/world/map-pins";

export interface Scene3DRemotePlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  face: 1 | -1;
  phase: number;
  speed: number;
  shirtColor: string;
}

export interface Scene3DFrameInput {
  cw: number;
  ch: number;
  nowMs: number;
  dayPhase: number;
  nightAmt: number;
  space: string;
  camX: number;
  camY: number;
  playerX: number;
  playerY: number;
  playerFace: 1 | -1;
  playerPhase: number;
  playerSpeed: number;
  playerSwimming: boolean;
  equippedVehicle: VehicleItemId | null;
  effTileAt: (x: number, y: number) => number;
  tilesOverrides: TileOverridesMap;
  indoor: LobbyData | null;
  interiorSpec: SettlementInteriorSpec | null;
  remotes: readonly Scene3DRemotePlayer[];
  nations: readonly {
    id: string;
    name: string;
    color: string;
    capital: { x: number; y: number };
  }[];
  pins: readonly MapPin[];
  trackedTarget: TrackedTarget | null;
  cameraYaw: number;
  cameraPitch: number;
  cameraDist: number;
}

const MAX_GROUND_INSTANCES = 4200;
const MAX_PROP_INSTANCES = 1800;
const MAX_WALL_INSTANCES = 2600;

const FLOOR_COLORS: Record<number, number> = {
  [L_WALL]: 0x334155,
  [L_MARBLE]: 0xe2e8f0,
  [L_PLAZA]: 0xcbd5e1,
  [L_RING]: 0x94a3b8,
  [L_CARPET]: 0xb91c1c,
  [L_WOOD]: 0x9a6b3e,
  [L_SAND]: 0xdcc68c,
  [L_DARK]: 0x3f4451,
  [L_CHECK]: 0x64748b,
  [L_CONCRETE]: 0x71717a,
};

const WORLD_TILE_COLOR: Record<number, number> = {
  [T_GRASS]: 0x4ca135,
  [T_WATER]: 0x2a76b8,
  [T_SAND]: 0xe2d295,
  [T_TREE]: 0x3b852a,
  [T_ROCK]: 0x7e838c,
  [T_DIRT]: 0x8c5d32,
  [T_SNOW]: 0xeaf2f8,
  [T_SNOW_TREE]: 0xd8e7ef,
};

function parseHexColor(hex: string, fallback = 0x38bdf8): number {
  const clean = hex.replace("#", "").trim();
  const num = Number.parseInt(clean, 16);
  return Number.isFinite(num) ? num : fallback;
}

function createAvatarRig(): THREE.Group {
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.65 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf7d2b4, roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.28), bodyMat);
  torso.position.y = 0.72;
  torso.castShadow = true;
  torso.name = "torso";
  g.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), skinMat);
  head.position.y = 1.2;
  head.castShadow = true;
  g.add(head);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.42), hairMat);
  hair.position.y = 1.38;
  g.add(hair);

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.18), legMat);
  leftLeg.position.set(-0.12, 0.22, 0);
  leftLeg.name = "leftLeg";
  g.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.18), legMat);
  rightLeg.position.set(0.12, 0.22, 0);
  rightLeg.name = "rightLeg";
  g.add(rightLeg);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.44, 0.16), bodyMat);
  leftArm.position.set(-0.32, 0.72, 0);
  leftArm.name = "leftArm";
  g.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.44, 0.16), bodyMat);
  rightArm.position.set(0.32, 0.72, 0);
  rightArm.name = "rightArm";
  g.add(rightArm);

  g.userData.bodyMat = bodyMat;
  g.userData.leftLeg = leftLeg;
  g.userData.rightLeg = rightLeg;
  g.userData.leftArm = leftArm;
  g.userData.rightArm = rightArm;
  return g;
}

function updateAvatarRig(
  g: THREE.Group,
  x: number,
  y: number,
  elevation: number,
  face: 1 | -1,
  walkPhase: number,
  walkSpeed: number,
  shirtColor: number,
): void {
  const mat = g.userData.bodyMat as THREE.MeshStandardMaterial;
  mat.color.setHex(shirtColor);
  const swing = Math.sin(walkPhase) * Math.min(0.65, walkSpeed * 0.22);
  const bob = Math.abs(Math.sin(walkPhase)) * Math.min(0.08, walkSpeed * 0.025);
  g.position.set(x, elevation + bob, y);
  g.rotation.y = face < 0 ? -Math.PI * 0.45 : Math.PI * 0.45;
  (g.userData.leftLeg as THREE.Mesh).rotation.x = swing;
  (g.userData.rightLeg as THREE.Mesh).rotation.x = -swing;
  (g.userData.leftArm as THREE.Mesh).rotation.x = -swing * 0.85;
  (g.userData.rightArm as THREE.Mesh).rotation.x = swing * 0.85;
}

function createVehicleRig(): THREE.Group {
  const g = new THREE.Group();
  const chassisMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    roughness: 0.35,
    metalness: 0.4,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.4,
    metalness: 0.2,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbae6fd,
    roughness: 0.15,
    metalness: 0.6,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.42, 0.82), chassisMat);
  body.position.y = 0.34;
  body.castShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.34, 0.72), trimMat);
  cabin.position.set(0.05, 0.68, 0);
  cabin.castShadow = true;
  g.add(cabin);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.2, 0.64), glassMat);
  windshield.position.set(0.05, 0.68, 0);
  g.add(windshield);

  const wheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.14, 10);
  wheelGeo.rotateX(Math.PI / 2);
  for (const [wx, wz] of [
    [-0.44, 0.42],
    [0.44, 0.42],
    [-0.44, -0.42],
    [0.44, -0.42],
  ]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, 0.18, wz);
    g.add(w);
  }

  const sirenMatL = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const sirenMatR = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
  const sirenL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.22), sirenMatL);
  sirenL.position.set(0.05, 0.9, -0.13);
  const sirenR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.22), sirenMatR);
  sirenR.position.set(0.05, 0.9, 0.13);
  g.add(sirenL);
  g.add(sirenR);

  g.userData.chassisMat = chassisMat;
  g.userData.trimMat = trimMat;
  g.userData.cabin = cabin;
  g.userData.windshield = windshield;
  g.userData.sirenL = sirenL;
  g.userData.sirenR = sirenR;
  g.userData.sirenMatL = sirenMatL;
  g.userData.sirenMatR = sirenMatR;
  return g;
}

export class WorldBox3DScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private hemiLight: THREE.HemisphereLight;
  private sunLight: THREE.DirectionalLight;
  private groundMesh: THREE.InstancedMesh;
  private waterMesh: THREE.InstancedMesh;
  private wallMesh: THREE.InstancedMesh;
  private treeTrunkMesh: THREE.InstancedMesh;
  private treeCrownMesh: THREE.InstancedMesh;
  private rockMesh: THREE.InstancedMesh;
  private lampPoleMesh: THREE.InstancedMesh;
  private lampBulbMesh: THREE.InstancedMesh;
  private roofMesh: THREE.InstancedMesh;
  private buildingWallMesh: THREE.InstancedMesh;
  private doorMesh: THREE.InstancedMesh;
  private propMesh: THREE.InstancedMesh;

  private playerRig: THREE.Group;
  private vehicleRig: THREE.Group;
  private entityPool: THREE.Group[] = [];
  private showroomPool: THREE.Group[] = [];
  private pinGroup: THREE.Group;
  private beaconMesh: THREE.Mesh;
  private beaconRing: THREE.Mesh;
  private exitGlowMesh: THREE.Mesh;

  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private tmpVec3 = new THREE.Vector3();
  private tmpNdc = new THREE.Vector2();
  private lastW = 0;
  private lastH = 0;

  private constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x162235);
    this.scene.fog = new THREE.FogExp2(0x162235, 0.018);

    this.camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.4, 160);

    this.hemiLight = new THREE.HemisphereLight(0xcbe8ff, 0x263529, 0.95);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff4db, 1.35);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 90;
    const d = 28;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0006;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    const stdMat = () =>
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.78,
        metalness: 0.06,
      });

    this.groundMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.01, 1, 1.01),
      stdMat(),
      MAX_GROUND_INSTANCES,
    );
    this.groundMesh.receiveShadow = true;
    this.groundMesh.frustumCulled = false;
    this.scene.add(this.groundMesh);

    this.waterMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.02, 0.45, 1.02),
      new THREE.MeshStandardMaterial({
        color: 0x3898dc,
        roughness: 0.16,
        metalness: 0.28,
        transparent: true,
        opacity: 0.86,
      }),
      MAX_GROUND_INSTANCES,
    );
    this.waterMesh.receiveShadow = true;
    this.waterMesh.frustumCulled = false;
    this.scene.add(this.waterMesh);

    this.wallMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.01, 1, 1.01),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.08 }),
      MAX_WALL_INSTANCES,
    );
    this.wallMesh.castShadow = true;
    this.wallMesh.receiveShadow = true;
    this.wallMesh.frustumCulled = false;
    this.scene.add(this.wallMesh);

    this.treeTrunkMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.14, 0.2, 0.85, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }),
      MAX_PROP_INSTANCES,
    );
    this.treeTrunkMesh.castShadow = true;
    this.treeTrunkMesh.frustumCulled = false;
    this.scene.add(this.treeTrunkMesh);

    this.treeCrownMesh = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.58, 1.45, 7),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }),
      MAX_PROP_INSTANCES,
    );
    this.treeCrownMesh.castShadow = true;
    this.treeCrownMesh.receiveShadow = true;
    this.treeCrownMesh.frustumCulled = false;
    this.scene.add(this.treeCrownMesh);

    this.rockMesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.52, 0),
      new THREE.MeshStandardMaterial({ color: 0x868c96, roughness: 0.88 }),
      MAX_PROP_INSTANCES,
    );
    this.rockMesh.castShadow = true;
    this.rockMesh.receiveShadow = true;
    this.rockMesh.frustumCulled = false;
    this.scene.add(this.rockMesh);

    this.lampPoleMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.06, 0.09, 2.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.4 }),
      256,
    );
    this.lampPoleMesh.castShadow = true;
    this.lampPoleMesh.frustumCulled = false;
    this.scene.add(this.lampPoleMesh);

    this.lampBulbMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfde047 }),
      256,
    );
    this.lampBulbMesh.frustumCulled = false;
    this.scene.add(this.lampBulbMesh);

    this.buildingWallMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 }),
      256,
    );
    this.buildingWallMesh.castShadow = true;
    this.buildingWallMesh.receiveShadow = true;
    this.buildingWallMesh.frustumCulled = false;
    this.scene.add(this.buildingWallMesh);

    this.roofMesh = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.78, 1, 4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
      256,
    );
    this.roofMesh.castShadow = true;
    this.roofMesh.receiveShadow = true;
    this.roofMesh.frustumCulled = false;
    this.scene.add(this.roofMesh);

    this.doorMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.75, 1.35, 0.25),
      new THREE.MeshBasicMaterial({ color: 0xfef08a }),
      256,
    );
    this.doorMesh.frustumCulled = false;
    this.scene.add(this.doorMesh);

    this.propMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.18 }),
      MAX_PROP_INSTANCES,
    );
    this.propMesh.castShadow = true;
    this.propMesh.receiveShadow = true;
    this.propMesh.frustumCulled = false;
    this.scene.add(this.propMesh);

    this.playerRig = createAvatarRig();
    this.scene.add(this.playerRig);

    this.vehicleRig = createVehicleRig();
    this.vehicleRig.visible = false;
    this.scene.add(this.vehicleRig);

    this.pinGroup = new THREE.Group();
    this.scene.add(this.pinGroup);

    this.beaconMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.28, 22, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.beaconMesh.visible = false;
    this.scene.add(this.beaconMesh);

    this.beaconRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.72, 24),
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      }),
    );
    this.beaconRing.rotation.x = -Math.PI / 2;
    this.beaconRing.visible = false;
    this.scene.add(this.beaconRing);

    this.exitGlowMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.08, 1.0),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.65 }),
    );
    this.exitGlowMesh.visible = false;
    this.scene.add(this.exitGlowMesh);
  }

  static tryCreate(canvas: HTMLCanvasElement): WorldBox3DScene | null {
    try {
      return new WorldBox3DScene(canvas);
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.renderer.dispose();
  }

  private getEntityRig(idx: number): THREE.Group {
    while (this.entityPool.length <= idx) {
      const rig = createAvatarRig();
      this.scene.add(rig);
      this.entityPool.push(rig);
    }
    const rig = this.entityPool[idx];
    rig.visible = true;
    return rig;
  }

  private getShowroomRig(idx: number): THREE.Group {
    while (this.showroomPool.length <= idx) {
      const rig = createVehicleRig();
      this.scene.add(rig);
      this.showroomPool.push(rig);
    }
    const rig = this.showroomPool[idx];
    rig.visible = true;
    return rig;
  }

  screenToWorldTile(
    px: number,
    py: number,
    cw: number,
    ch: number,
  ): { x: number; y: number } | null {
    if (cw <= 0 || ch <= 0) return null;
    this.tmpNdc.set((px / cw) * 2 - 1, -(py / ch) * 2 + 1);
    this.raycaster.setFromCamera(this.tmpNdc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return { x: Math.floor(hit.x), y: Math.floor(hit.z) };
  }

  projectWorldToScreen(
    wx: number,
    wy: number,
    wz: number,
    cw: number,
    ch: number,
  ): { x: number; y: number; visible: boolean } {
    this.tmpVec3.set(wx, wz, wy);
    this.tmpVec3.project(this.camera);
    const visible = this.tmpVec3.z >= -1 && this.tmpVec3.z <= 1;
    return {
      x: (this.tmpVec3.x * 0.5 + 0.5) * cw,
      y: (-this.tmpVec3.y * 0.5 + 0.5) * ch,
      visible,
    };
  }

  render(frame: Scene3DFrameInput): void {
    const { cw, ch, nowMs, nightAmt, space } = frame;
    if (cw <= 0 || ch <= 0) return;
    if (cw !== this.lastW || ch !== this.lastH) {
      this.lastW = cw;
      this.lastH = ch;
      this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
      this.renderer.setSize(cw, ch, false);
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
    }

    // Update camera smoothly in spherical orbit around (camX, camY)
    const dist = Math.max(8, Math.min(34, frame.cameraDist));
    const pitch = Math.max(0.45, Math.min(1.28, frame.cameraPitch));
    const horiz = Math.cos(pitch) * dist;
    const vert = Math.sin(pitch) * dist;
    const camPosX = frame.camX + Math.sin(frame.cameraYaw) * horiz;
    const camPosZ = frame.camY + Math.cos(frame.cameraYaw) * horiz;
    this.camera.position.set(camPosX, vert, camPosZ);
    this.camera.lookAt(frame.camX, 0.4, frame.camY);

    // Dynamic lighting and sky tone
    const isWorld = space === "world";
    const effNight = isWorld ? nightAmt : 0.12;
    const skyDay = new THREE.Color(isWorld ? 0x7cb8e8 : 0x111827);
    const skyNight = new THREE.Color(0x0b1224);
    const skyNow = skyDay.lerp(skyNight, effNight);
    this.scene.background = skyNow;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(skyNow);
      this.scene.fog.density = isWorld ? 0.014 : 0.011;
    }

    this.hemiLight.intensity = isWorld ? 1.05 - effNight * 0.65 : 1.08;
    this.sunLight.intensity = isWorld ? 1.45 - effNight * 1.05 : 1.15;
    this.sunLight.color.setHex(effNight > 0.45 ? 0x93c5fd : 0xfff5dc);
    this.sunLight.position.set(frame.camX + 16, 26, frame.camY + 12);
    this.sunLight.target.position.set(frame.camX, 0, frame.camY);
    this.sunLight.target.updateMatrixWorld();

    let groundN = 0;
    let waterN = 0;
    let wallN = 0;
    let trunkN = 0;
    let crownN = 0;
    let rockN = 0;
    let lampN = 0;
    let bWallN = 0;
    let roofN = 0;
    let doorN = 0;
    let propN = 0;
    let entityN = 0;
    let showroomN = 0;

    const pushBox = (
      mesh: THREE.InstancedMesh,
      idx: number,
      max: number,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      colorHex: number,
      rotY = 0,
    ): number => {
      if (idx >= max) return idx;
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(0, rotY, 0);
      this.dummy.scale.set(sx, sy, sz);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(idx, this.dummy.matrix);
      this.tmpColor.setHex(colorHex);
      mesh.setColorAt(idx, this.tmpColor);
      return idx + 1;
    };

    this.exitGlowMesh.visible = false;

    if (isWorld) {
      const spanX = 24;
      const spanY = 24;
      const minX = Math.floor(frame.camX) - spanX;
      const maxX = Math.floor(frame.camX) + spanX;
      const minY = Math.floor(frame.camY) - spanY;
      const maxY = Math.floor(frame.camY) + spanY;

      const nearStls: Settlement[] = settlementsNear(frame.camX, frame.camY, 44, MAP_SEED);
      const waveOff = Math.sin(nowMs * 0.0025) * 0.05;

      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          let surf: string | null = null;
          for (const stl of nearStls) {
            if (Math.abs(tx - stl.cx) <= stl.radius && Math.abs(ty - stl.cy) <= stl.radius) {
              surf = settlementSurfaceAt(stl, tx, ty);
              if (surf) break;
            }
          }

          const tid = frame.effTileAt(tx, ty);
          const iv = tileIvsAt(tx, ty);
          const elevBase = tid === T_WATER ? -0.35 : Math.max(0, (iv.altitude - 35) * 0.012);

          if (surf === "pier") {
            waterN = pushBox(
              this.waterMesh,
              waterN,
              MAX_GROUND_INSTANCES,
              tx + 0.5,
              -0.35 + waveOff,
              ty + 0.5,
              1,
              1,
              1,
              0x2574b8,
            );
            groundN = pushBox(
              this.groundMesh,
              groundN,
              MAX_GROUND_INSTANCES,
              tx + 0.5,
              0.02,
              ty + 0.5,
              1,
              0.18,
              1,
              0x915f37,
            );
          } else if (surf === "plaza") {
            groundN = pushBox(
              this.groundMesh,
              groundN,
              MAX_GROUND_INSTANCES,
              tx + 0.5,
              0.03,
              ty + 0.5,
              1,
              0.24,
              1,
              0x94a3b8,
            );
          } else if (surf === "road" || surf === "sidewalk") {
            groundN = pushBox(
              this.groundMesh,
              groundN,
              MAX_GROUND_INSTANCES,
              tx + 0.5,
              0.01,
              ty + 0.5,
              1,
              0.2,
              1,
              0x475569,
            );
          } else if (surf === "farm") {
            groundN = pushBox(
              this.groundMesh,
              groundN,
              MAX_GROUND_INSTANCES,
              tx + 0.5,
              0.02,
              ty + 0.5,
              1,
              0.2,
              1,
              0x5c3d22,
            );
            propN = pushBox(
              this.propMesh,
              propN,
              MAX_PROP_INSTANCES,
              tx + 0.5,
              0.24,
              ty + 0.5,
              0.62,
              0.28,
              0.62,
              0x22c55e,
            );
          } else if (tid === T_WATER) {
            waterN = pushBox(
              this.waterMesh,
              waterN,
              MAX_GROUND_INSTANCES,
              tx + 0.5,
              -0.32 + waveOff,
              ty + 0.5,
              1,
              1,
              1,
              0x2b82c9,
            );
          } else {
            const h = 0.24 + elevBase;
            groundN = pushBox(
              this.groundMesh,
              groundN,
              MAX_GROUND_INSTANCES,
              tx + 0.5,
              h / 2 - 0.14,
              ty + 0.5,
              1,
              h,
              1,
              WORLD_TILE_COLOR[tid] ?? 0x4ca135,
            );
            const topY = h - 0.14;
            if (tid === T_TREE || tid === T_SNOW_TREE) {
              trunkN = pushBox(
                this.treeTrunkMesh,
                trunkN,
                MAX_PROP_INSTANCES,
                tx + 0.5,
                topY + 0.42,
                ty + 0.5,
                1,
                1,
                1,
                0x6b4423,
              );
              crownN = pushBox(
                this.treeCrownMesh,
                crownN,
                MAX_PROP_INSTANCES,
                tx + 0.5,
                topY + 1.35,
                ty + 0.5,
                1,
                1,
                1,
                tid === T_SNOW_TREE ? 0xdff2f8 : 0x2a6c22,
              );
            } else if (tid === T_ROCK) {
              rockN = pushBox(
                this.rockMesh,
                rockN,
                MAX_PROP_INSTANCES,
                tx + 0.5,
                topY + 0.42,
                ty + 0.5,
                1,
                1.15,
                1,
                0x808792,
              );
            }
          }

          // Player-placed world blocks / machines / crops
          const ov = frame.tilesOverrides[tileKey(tx, ty)];
          if (ov && ov.block && isOverrideActive(ov, nowMs)) {
            const bid = ov.block.itemId;
            const col = bid.includes("wood")
              ? 0x9c6c3b
              : bid.includes("stone") || bid.includes("brick")
                ? 0x94a3b8
                : bid.includes("glass")
                  ? 0x7dd3fc
                  : bid.includes("lamp") || bid.includes("torch")
                    ? 0xfde047
                    : 0xd97706;
            propN = pushBox(
              this.propMesh,
              propN,
              MAX_PROP_INSTANCES,
              tx + 0.5,
              0.55,
              ty + 0.5,
              0.88,
              0.88,
              0.88,
              col,
            );
          }
        }
      }

      // 3D Settlement Buildings, Streetlamps, & Interactive Street Citizens
      for (const stl of nearStls) {
        for (const lamp of stl.lamps) {
          if (
            Math.abs(lamp.x - frame.camX) > spanX + 3 ||
            Math.abs(lamp.y - frame.camY) > spanY + 3
          )
            continue;
          const idx = lampN;
          if (idx < 256) {
            pushBox(
              this.lampPoleMesh,
              idx,
              256,
              lamp.x + 0.5,
              1.1,
              lamp.y + 0.5,
              1,
              1,
              1,
              0x334155,
            );
            pushBox(
              this.lampBulbMesh,
              idx,
              256,
              lamp.x + 0.5,
              2.25,
              lamp.y + 0.5,
              1,
              1,
              1,
              effNight > 0.12 ? 0xfef08a : 0xe2e8f0,
            );
            lampN++;
          }
        }

        for (const b of stl.buildings) {
          const cxB = b.x + b.w / 2;
          const czB = b.y + b.h / 2;
          if (Math.abs(cxB - frame.camX) > spanX + 8 || Math.abs(czB - frame.camY) > spanY + 8)
            continue;
          const wallH = b.kind === "city_hall" || b.kind === "vehicle_dealer" ? 2.6 : 2.1;
          bWallN = pushBox(
            this.buildingWallMesh,
            bWallN,
            256,
            cxB,
            wallH / 2 + 0.05,
            czB,
            b.w - 0.14,
            wallH,
            b.h - 0.14,
            parseHexColor(b.wallColor, 0xf8fafc),
          );
          roofN = pushBox(
            this.roofMesh,
            roofN,
            256,
            cxB,
            wallH + 0.8,
            czB,
            b.w * 1.02,
            1.45,
            b.h * 1.02,
            parseHexColor(b.roofColor, 0x0284c7),
            Math.PI / 4,
          );
          // Recessed glowing doorway portal on exterior threshold
          const doorRot = b.facing === "e" || b.facing === "w" ? Math.PI / 2 : 0;
          const doorOffX = b.facing === "e" ? 0.42 : b.facing === "w" ? -0.42 : 0;
          const doorOffZ = b.facing === "s" ? 0.42 : b.facing === "n" ? -0.42 : 0;
          doorN = pushBox(
            this.doorMesh,
            doorN,
            256,
            b.doorX + 0.5 + doorOffX,
            0.78,
            b.doorY + 0.5 + doorOffZ,
            1,
            1,
            1,
            effNight > 0.12 ? 0xfcd34d : 0xfef08a,
            doorRot,
          );
          // Colorful commercial signboard banner on front roof lip
          propN = pushBox(
            this.propMesh,
            propN,
            MAX_PROP_INSTANCES,
            b.doorX + 0.5 + doorOffX * 1.15,
            wallH - 0.1,
            b.doorY + 0.5 + doorOffZ * 1.15,
            doorRot === 0 ? 1.8 : 0.2,
            0.35,
            doorRot === 0 ? 0.2 : 1.8,
            parseHexColor(b.signColor, 0x38bdf8),
          );
        }

        for (const cit of stl.citizens) {
          const pose = evaluateCitizenPose(stl, cit, frame.dayPhase, nowMs);
          if (pose.sleeping) continue;
          if (
            Math.abs(pose.x - frame.camX) > spanX + 2 ||
            Math.abs(pose.y - frame.camY) > spanY + 2
          )
            continue;
          const rig = this.getEntityRig(entityN++);
          updateAvatarRig(
            rig,
            pose.x,
            pose.y,
            0.14,
            pose.face,
            pose.walkPhase,
            pose.walkSpeed,
            parseHexColor(cit.shirtColor, 0x38bdf8),
          );
        }
      }

      // Nation Capitals (3D Castles)
      for (const n of frame.nations) {
        if (
          Math.abs(n.capital.x - frame.camX) > spanX + 4 ||
          Math.abs(n.capital.y - frame.camY) > spanY + 4
        )
          continue;
        propN = pushBox(
          this.propMesh,
          propN,
          MAX_PROP_INSTANCES,
          n.capital.x + 0.5,
          1.0,
          n.capital.y + 0.5,
          1.2,
          2.0,
          1.2,
          0x94a3b8,
        );
        propN = pushBox(
          this.propMesh,
          propN,
          MAX_PROP_INSTANCES,
          n.capital.x + 0.5,
          2.45,
          n.capital.y + 0.5,
          0.7,
          0.45,
          0.16,
          parseHexColor(n.color, 0x38bdf8),
        );
      }
    } else if (frame.indoor) {
      // 3D Indoor Mode: Lobby 1F/2F/3F, Prison, Apartments, Tent, Caves, Ruins, Dungeons, Settlement Store Interiors!
      const indoor = frame.indoor;
      const minX = Math.max(0, Math.floor(frame.camX) - 24);
      const maxX = Math.min(indoor.width - 1, Math.floor(frame.camX) + 24);
      const minY = Math.max(0, Math.floor(frame.camY) - 24);
      const maxY = Math.min(indoor.height - 1, Math.floor(frame.camY) + 24);

      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          const id = indoor.tiles[ty * indoor.width + tx] ?? L_VOID;
          if (id === L_VOID) continue;
          if (id === L_WALL) {
            wallN = pushBox(
              this.wallMesh,
              wallN,
              MAX_WALL_INSTANCES,
              tx + 0.5,
              1.15,
              ty + 0.5,
              1,
              2.3,
              1,
              0x334155,
            );
          } else {
            groundN = pushBox(
              this.groundMesh,
              groundN,
              MAX_GROUND_INSTANCES,
              tx + 0.5,
              -0.08,
              ty + 0.5,
              1,
              0.2,
              1,
              FLOOR_COLORS[id] ?? 0x94a3b8,
            );
          }
        }
      }

      for (const o of indoor.objects) {
        if (o.x + o.w < minX - 2 || o.x > maxX + 2 || o.y + o.h < minY - 2 || o.y > maxY + 2)
          continue;
        const ox = o.x + o.w / 2;
        const oz = o.y + o.h / 2;
        const h =
          o.sprite.includes("shelf") ||
          o.sprite.includes("bookshelf") ||
          o.sprite.includes("vault") ||
          o.sprite.includes("vending")
            ? 1.7
            : o.sprite.includes("counter") ||
                o.sprite.includes("workbench") ||
                o.sprite.includes("furnace") ||
                o.sprite.includes("display")
              ? 1.05
              : o.sprite.includes("lamp")
                ? 2.1
                : o.sprite.includes("chair") ||
                    o.sprite.includes("sofa") ||
                    o.sprite.includes("bench")
                  ? 0.55
                  : o.sprite.includes("table") ||
                      o.sprite.includes("anvil") ||
                      o.sprite.includes("crate") ||
                      o.sprite.includes("barrel")
                    ? 0.78
                    : 0.95;

        const col =
          o.station === "dealer"
            ? 0x0ea5e9
            : o.station === "bank" || o.station === "stock"
              ? 0xeab308
              : o.station === "shop" || o.station === "sell"
                ? 0xf97316
                : o.station === "smith"
                  ? 0xb45309
                  : o.station === "casino" || o.station === "arcade"
                    ? 0xa855f7
                    : o.station === "prison_escape"
                      ? 0xef4444
                      : o.sprite.includes("planter") || o.sprite.includes("hedge")
                        ? 0x22c55e
                        : o.sprite.includes("lamp")
                          ? 0xfde047
                          : 0x8b6b4a;

        propN = pushBox(
          this.propMesh,
          propN,
          MAX_PROP_INSTANCES,
          ox,
          h / 2 + 0.02,
          oz,
          Math.max(0.55, o.w - 0.14),
          h,
          Math.max(0.55, o.h - 0.14),
          col,
        );
      }

      if (frame.interiorSpec) {
        const intr = frame.interiorSpec;
        this.exitGlowMesh.visible = true;
        this.exitGlowMesh.position.set(
          intr.exitMat.x + intr.exitMat.w / 2,
          0.08,
          intr.exitMat.y + 0.5,
        );

        for (const bay of intr.dealerBays) {
          const spec = vehicleSpecFor(bay.vehicleId);
          const rig = this.getShowroomRig(showroomN++);
          rig.position.set(bay.x + 0.5, 0.12, bay.y + 0.5);
          rig.rotation.y = (nowMs * 0.00055) % (Math.PI * 2);
          (rig.userData.chassisMat as THREE.MeshStandardMaterial).color.setHex(
            parseHexColor(spec?.bodyColor ?? bay.accent),
          );
          (rig.userData.trimMat as THREE.MeshStandardMaterial).color.setHex(
            parseHexColor(spec?.trimColor ?? "#f8fafc"),
          );
          (rig.userData.sirenL as THREE.Mesh).visible = Boolean(spec?.hasSiren);
          (rig.userData.sirenR as THREE.Mesh).visible = Boolean(spec?.hasSiren);
        }

        for (const stf of intr.staff) {
          const rig = this.getEntityRig(entityN++);
          updateAvatarRig(
            rig,
            stf.x,
            stf.y,
            0.04,
            1,
            0,
            0,
            parseHexColor(stf.shirtColor, 0x38bdf8),
          );
        }
      } else {
        for (const npc of indoor.npcs) {
          if (Math.abs(npc.x - frame.camX) > 24 || Math.abs(npc.y - frame.camY) > 24) continue;
          const rig = this.getEntityRig(entityN++);
          updateAvatarRig(rig, npc.x + 0.5, npc.y + 0.5, 0.04, 1, 0, 0, 0x0ea5e9);
        }
      }
    }

    // Online multiplayer remote avatars
    for (const r of frame.remotes) {
      const rig = this.getEntityRig(entityN++);
      updateAvatarRig(
        rig,
        r.x,
        r.y,
        0.12,
        r.face,
        r.phase,
        r.speed,
        parseHexColor(r.shirtColor, 0x4ade80),
      );
    }

    // Local Player + Rideable 3D Vehicle
    const vSpec = vehicleSpecFor(frame.equippedVehicle);
    const riding = Boolean(vSpec && !frame.playerSwimming);
    const playerElev = frame.playerSwimming ? -0.35 : riding ? 0.58 : 0.12;
    updateAvatarRig(
      this.playerRig,
      frame.playerX,
      frame.playerY,
      playerElev,
      frame.playerFace,
      riding ? 0 : frame.playerPhase,
      riding ? 0 : frame.playerSpeed,
      0x38bdf8,
    );

    if (riding && vSpec) {
      this.vehicleRig.visible = true;
      this.vehicleRig.position.set(frame.playerX, 0.08, frame.playerY);
      this.vehicleRig.rotation.y = frame.playerFace < 0 ? Math.PI : 0;
      (this.vehicleRig.userData.chassisMat as THREE.MeshStandardMaterial).color.setHex(
        parseHexColor(vSpec.bodyColor),
      );
      (this.vehicleRig.userData.trimMat as THREE.MeshStandardMaterial).color.setHex(
        parseHexColor(vSpec.trimColor),
      );
      const hasSiren = Boolean(vSpec.hasSiren);
      (this.vehicleRig.userData.sirenL as THREE.Mesh).visible = hasSiren;
      (this.vehicleRig.userData.sirenR as THREE.Mesh).visible = hasSiren;
      if (hasSiren) {
        const flash = Math.floor(nowMs / 180) % 2 === 0;
        (this.vehicleRig.userData.sirenMatL as THREE.MeshBasicMaterial).color.setHex(
          flash ? 0xef4444 : 0x3b82f6,
        );
        (this.vehicleRig.userData.sirenMatR as THREE.MeshBasicMaterial).color.setHex(
          flash ? 0x3b82f6 : 0xef4444,
        );
      }
    } else {
      this.vehicleRig.visible = false;
    }

    // Tracked target vertical sky-beam & pulsing ground ring
    let targetX: number | null = null;
    let targetY: number | null = null;
    const tt = frame.trackedTarget;
    if (tt) {
      if (tt.kind === "player") {
        const hit = frame.remotes.find((r) => r.id === tt.presenceId);
        if (hit) {
          targetX = hit.x;
          targetY = hit.y;
        }
      } else if (tt.space === space) {
        targetX = tt.x + 0.5;
        targetY = tt.y + 0.5;
      }
    }
    if (targetX !== null && targetY !== null) {
      this.beaconMesh.visible = true;
      this.beaconRing.visible = true;
      this.beaconMesh.position.set(targetX, 11, targetY);
      this.beaconRing.position.set(targetX, 0.16, targetY);
      const pulse = 1 + Math.sin(nowMs * 0.006) * 0.22;
      this.beaconRing.scale.set(pulse, pulse, 1);
    } else {
      this.beaconMesh.visible = false;
      this.beaconRing.visible = false;
    }

    // Hide unused pooled entities
    for (let i = entityN; i < this.entityPool.length; i++) this.entityPool[i].visible = false;
    for (let i = showroomN; i < this.showroomPool.length; i++) this.showroomPool[i].visible = false;

    // Commit instanced mesh counts & dirty flags
    const finalize = (m: THREE.InstancedMesh, count: number) => {
      m.count = count;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    finalize(this.groundMesh, groundN);
    finalize(this.waterMesh, waterN);
    finalize(this.wallMesh, wallN);
    finalize(this.treeTrunkMesh, trunkN);
    finalize(this.treeCrownMesh, crownN);
    finalize(this.rockMesh, rockN);
    finalize(this.lampPoleMesh, lampN);
    finalize(this.lampBulbMesh, lampN);
    finalize(this.buildingWallMesh, bWallN);
    finalize(this.roofMesh, roofN);
    finalize(this.doorMesh, doorN);
    finalize(this.propMesh, propN);

    this.renderer.render(this.scene, this.camera);
  }
}
