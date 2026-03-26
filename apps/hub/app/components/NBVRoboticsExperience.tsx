"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import styles from "./NBVRoboticsExperience.module.css";
import {
  FINGERTIP_INDICES,
  GLOBAL_MENU_FLAG_KEY,
  type Landmark,
  type VisionModule,
  clamp,
  clamp01,
  distance,
  getHandScale,
  getLargestHand,
  isHandClustered,
  isOpenPalm,
  loadVisionModule,
  splitHandsBySide,
} from "./hand-tracking";

type SensorState = "tracking" | "searching" | "camera-blocked" | "low-light";
type ShapeType = "box" | "cylinder" | "sphere";

type SceneObjectSpec = {
  id: string;
  name: string;
  semanticClass: string;
  description: string;
  graspNote: string;
  shape: ShapeType;
  color: string;
  size: [number, number, number];
  position: [number, number, number];
  initialUncertainty: number;
};

type CandidateViewSpec = {
  id: string;
  label: string;
  emphasis: string;
  position: [number, number, number];
};

type UncertaintySnapshot = {
  id: string;
  name: string;
  value: number;
  semanticClass: string;
};

type HudSnapshot = {
  activeView: string;
  bestView: string;
  bestGain: number;
  movementHint: string;
  visibleCount: number;
  totalUncertainty: number;
  hoveredId: string | null;
  grabbedId: string | null;
  uncertainties: UncertaintySnapshot[];
};

type RuntimeObject = {
  spec: SceneObjectSpec;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  halo: THREE.Mesh;
  uncertainty: number;
};

const CURSOR_GAIN_X = 1.72;
const CURSOR_GAIN_Y = 1.56;
const POINTER_SMOOTHING = 0.34;
const LOW_LIGHT_THRESHOLD = 40;
const PINCH_THRESHOLD = 0.46;
const MENU_RETURN_HOLD_MS = 220;
const VIEW_SWITCH_COOLDOWN_MS = 700;
const HUD_PUBLISH_MS = 140;

const NBV_OBJECTS: SceneObjectSpec[] = [
  {
    id: "crate-alpha",
    name: "Crate Alpha",
    semanticClass: "Container",
    description:
      "A front-left storage crate that blocks direct line of sight into the center stack from shallow camera angles.",
    graspNote: "Good first grasp target for clearing center-line occlusion.",
    shape: "box",
    color: "#7a96ff",
    size: [1.45, 1.1, 1.2],
    position: [-1.35, 0.56, 0.24],
    initialUncertainty: 0.82,
  },
  {
    id: "sample-tray",
    name: "Sample Tray",
    semanticClass: "Tray",
    description:
      "A low tray tucked behind the front crate. Its class confidence spikes only when the sensor moves to an upper oblique view.",
    graspNote: "Usually revealed after moving the crate or taking a higher view.",
    shape: "box",
    color: "#69e0c8",
    size: [0.96, 0.28, 1.18],
    position: [0.22, 0.18, -0.38],
    initialUncertainty: 0.94,
  },
  {
    id: "valve-column",
    name: "Valve Column",
    semanticClass: "Industrial Valve",
    description:
      "A tall cylindrical valve assembly near the center that casts long self-occlusions when viewed from the front-right arc.",
    graspNote: "Stable grasp point sits around the upper cylinder body.",
    shape: "cylinder",
    color: "#ef8f63",
    size: [0.56, 1.66, 0.56],
    position: [0.42, 0.83, 0.16],
    initialUncertainty: 0.77,
  },
  {
    id: "coolant-canister",
    name: "Coolant Canister",
    semanticClass: "Canister",
    description:
      "A rear canister partially hidden by the valve column. It dominates the information gain of rear-right viewpoints.",
    graspNote: "Move the canister to open a cleaner line for the top camera.",
    shape: "cylinder",
    color: "#5ca4ff",
    size: [0.42, 1.16, 0.42],
    position: [1.2, 0.58, -0.7],
    initialUncertainty: 0.89,
  },
  {
    id: "sensor-pod",
    name: "Sensor Pod",
    semanticClass: "Sensor Head",
    description:
      "A spherical pod nested between larger parts. Semantic certainty depends heavily on removing front clutter or using the top sweep view.",
    graspNote: "Smallest grasp target. Best picked after clearing the tray.",
    shape: "sphere",
    color: "#d48cff",
    size: [0.62, 0.62, 0.62],
    position: [-0.08, 0.34, -1.02],
    initialUncertainty: 0.96,
  },
  {
    id: "lidar-head",
    name: "Lidar Head",
    semanticClass: "Perception Unit",
    description:
      "A top-mounted head that is visible from most views, making it a stable anchor for the segmentation pipeline.",
    graspNote: "High-confidence object used as the robot-arm alignment anchor.",
    shape: "box",
    color: "#ffd56f",
    size: [0.68, 0.44, 0.68],
    position: [-0.36, 1.58, 0.58],
    initialUncertainty: 0.42,
  },
];

const CANDIDATE_VIEWS: CandidateViewSpec[] = [
  {
    id: "front-left",
    label: "View A",
    emphasis: "Wide front-left sweep",
    position: [-4.8, 2.7, 4.6],
  },
  {
    id: "front-right",
    label: "View B",
    emphasis: "Front-right disambiguation",
    position: [4.8, 2.7, 4.2],
  },
  {
    id: "left-high",
    label: "View C",
    emphasis: "High left inspection",
    position: [-5.4, 4.1, 0.6],
  },
  {
    id: "right-high",
    label: "View D",
    emphasis: "High right clearance",
    position: [5.4, 4.0, 0.18],
  },
  {
    id: "rear-arc",
    label: "View E",
    emphasis: "Rear arc reveal",
    position: [0.3, 3.0, -5.2],
  },
  {
    id: "top-sweep",
    label: "View F",
    emphasis: "Top sweep for dense occlusion",
    position: [0, 5.8, 2.4],
  },
];

const FINGERTIP_COLORS = ["#f7c66a", "#8af4dd", "#f4f7fb", "#f39bd8", "#78b9ff"];

function mapPointer(point: Landmark, width: number, height: number, handScale: number) {
  const sensitivityFactor = clamp(0.18 / handScale, 0.9, 1.3);
  const normalizedX = clamp01(((1 - point.x) - 0.5) * CURSOR_GAIN_X * sensitivityFactor + 0.5);
  const normalizedY = clamp01((point.y - 0.5) * CURSOR_GAIN_Y * sensitivityFactor + 0.5);

  return {
    x: normalizedX * width,
    y: normalizedY * height,
  };
}

function isPinched(points: Landmark[]) {
  return distance(points[4], points[8]) / getHandScale(points) < PINCH_THRESHOLD;
}

function estimateBrightness(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  if (!video.videoWidth || !video.videoHeight) {
    return 255;
  }

  canvas.width = 24;
  canvas.height = 18;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return 255;
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let luminance = 0;

  for (let index = 0; index < data.length; index += 4) {
    luminance += data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
  }

  return luminance / (data.length / 4);
}

function drawPreview(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  hands: Landmark[][],
  pointerHand: Landmark[] | undefined,
  actionHand: Landmark[] | undefined,
  rightPinched: boolean,
  leftPinched: boolean,
) {
  if (!canvas || !video || !video.videoWidth || !video.videoHeight) {
    return;
  }

  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  hands.forEach((hand, handIndex) => {
    FINGERTIP_INDICES.forEach((tipIndex, tipOrder) => {
      const point = hand[tipIndex];
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;

      context.beginPath();
      context.fillStyle = FINGERTIP_COLORS[tipOrder];
      context.arc(
        x,
        y,
        hand === pointerHand && tipIndex === 8 ? 12 : hand === actionHand && tipIndex === 8 ? 10 : 8,
        0,
        Math.PI * 2,
      );
      context.fill();

      context.beginPath();
      context.lineWidth = handIndex === 0 ? 2.4 : 1.5;
      context.strokeStyle = "rgba(0, 0, 0, 0.62)";
      context.arc(
        x,
        y,
        hand === pointerHand && tipIndex === 8 ? 14 : hand === actionHand && tipIndex === 8 ? 12 : 10,
        0,
        Math.PI * 2,
      );
      context.stroke();
    });
  });

  if (pointerHand) {
    context.beginPath();
    context.moveTo(pointerHand[4].x * canvas.width, pointerHand[4].y * canvas.height);
    context.lineTo(pointerHand[8].x * canvas.width, pointerHand[8].y * canvas.height);
    context.lineWidth = 4;
    context.strokeStyle = rightPinched
      ? "rgba(255, 186, 122, 0.94)"
      : "rgba(255, 255, 255, 0.32)";
    context.stroke();
  }

  if (actionHand) {
    context.beginPath();
    context.moveTo(actionHand[4].x * canvas.width, actionHand[4].y * canvas.height);
    context.lineTo(actionHand[8].x * canvas.width, actionHand[8].y * canvas.height);
    context.lineWidth = 4;
    context.strokeStyle = leftPinched
      ? "rgba(123, 236, 220, 0.94)"
      : "rgba(255, 255, 255, 0.26)";
    context.stroke();
  }
}

function createGeometry(spec: SceneObjectSpec) {
  if (spec.shape === "cylinder") {
    return new THREE.CylinderGeometry(spec.size[0], spec.size[0], spec.size[1], 32);
  }

  if (spec.shape === "sphere") {
    return new THREE.SphereGeometry(spec.size[0], 48, 32);
  }

  return new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]);
}

function createObject(runtimeScene: THREE.Scene, spec: SceneObjectSpec) {
  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.36,
    metalness: 0.42,
    emissive: "#020202",
    emissiveIntensity: 0.18,
  });
  const mesh = new THREE.Mesh(createGeometry(spec), material);
  mesh.position.set(spec.position[0], spec.position[1], spec.position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.objectId = spec.id;

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      opacity: 0.22,
      transparent: true,
    }),
  );
  mesh.add(outline);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(spec.size[0], spec.size[2]) * 0.7, Math.max(spec.size[0], spec.size[2]) * 0.92, 40),
    new THREE.MeshBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -spec.size[1] * 0.5 + 0.02;
  mesh.add(halo);

  runtimeScene.add(mesh);

  return {
    spec,
    mesh,
    material,
    halo,
    uncertainty: spec.initialUncertainty,
  };
}

function movementHint(current: CandidateViewSpec, next: CandidateViewSpec) {
  const deltaX = next.position[0] - current.position[0];
  const deltaY = next.position[1] - current.position[1];
  const deltaZ = next.position[2] - current.position[2];
  const horizontal = deltaX > 0.6 ? "right" : deltaX < -0.6 ? "left" : "center";
  const vertical = deltaY > 0.5 ? "rise" : deltaY < -0.5 ? "drop" : "hold";
  const depth = deltaZ > 0.6 ? "forward" : deltaZ < -0.6 ? "rear" : "mid";

  return `${vertical} / ${horizontal} / ${depth}`;
}

function projectToScreen(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
) {
  const projected = point.clone().project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
    visible: projected.z < 1.2,
  };
}

export function NBVRoboticsExperience() {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const threeFrameRef = useRef<number | null>(null);
  const trackingFrameRef = useRef<number | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const viewportRef = useRef({ width: 1280, height: 720 });
  const pointerRef = useRef({ x: 0, y: 0 });
  const pointerNdcRef = useRef(new THREE.Vector2(0, 0));
  const brightnessRef = useRef(255);
  const brightnessSampleFrameRef = useRef(0);
  const objectEntriesRef = useRef<RuntimeObject[]>([]);
  const candidateMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const candidateLookupRef = useRef<Map<string, CandidateViewSpec>>(new Map());
  const robotArmLineRef = useRef<THREE.Line | null>(null);
  const guideLineRef = useRef<THREE.Line | null>(null);
  const sensorRigRef = useRef<THREE.Mesh | null>(null);
  const guideConeRef = useRef<THREE.LineSegments | null>(null);
  const targetViewIdRef = useRef(CANDIDATE_VIEWS[0].id);
  const activeViewIdRef = useRef(CANDIDATE_VIEWS[0].id);
  const bestViewIdRef = useRef(CANDIDATE_VIEWS[0].id);
  const currentCameraPositionRef = useRef(new THREE.Vector3(...CANDIDATE_VIEWS[0].position));
  const rightPinchedRef = useRef(false);
  const leftPinchedRef = useRef(false);
  const grabbedIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const viewSwitchArmedAtRef = useRef(0);
  const menuReturnArmedAtRef = useRef<number | null>(null);
  const hudPublishAtRef = useRef(0);
  const grabPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const grabOffsetRef = useRef(new THREE.Vector3());
  const cameraTarget = useMemo(() => new THREE.Vector3(0, 0.78, 0), []);
  const objectLookup = useMemo(
    () => Object.fromEntries(NBV_OBJECTS.map((item) => [item.id, item])) as Record<string, SceneObjectSpec>,
    [],
  );
  const [sensorState, setSensorState] = useState<SensorState>("searching");
  const [statusLabel, setStatusLabel] = useState("Searching for hands");
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [hud, setHud] = useState<HudSnapshot>({
    activeView: CANDIDATE_VIEWS[0].label,
    bestView: CANDIDATE_VIEWS[0].label,
    bestGain: 0,
    movementHint: "hold / center / mid",
    visibleCount: 0,
    totalUncertainty: NBV_OBJECTS.reduce((sum, item) => sum + item.initialUncertainty, 0),
    hoveredId: null,
    grabbedId: null,
    uncertainties: NBV_OBJECTS.map((item) => ({
      id: item.id,
      name: item.name,
      value: item.initialUncertainty,
      semanticClass: item.semanticClass,
    })),
  });

  function currentCandidate(id: string) {
    return candidateLookupRef.current.get(id) ?? CANDIDATE_VIEWS[0];
  }

  function intersectPointerMesh() {
    const camera = cameraRef.current;
    if (!camera || objectEntriesRef.current.length === 0) {
      return null;
    }

    raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
    const hits = raycasterRef.current.intersectObjects(
      objectEntriesRef.current.map((entry) => entry.mesh),
      false,
    );

    return hits[0] ?? null;
  }

  useEffect(() => {
    const onResize = () => {
      viewportRef.current = {
        width: window.innerWidth,
        height: window.innerHeight,
      };

      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      if (renderer && camera) {
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
      }
    };

    onResize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#03050a");
    scene.fog = new THREE.Fog("#03050a", 14, 26);

    const camera = new THREE.PerspectiveCamera(
      34,
      viewportRef.current.width / viewportRef.current.height,
      0.1,
      80,
    );
    camera.position.copy(currentCameraPositionRef.current);
    camera.lookAt(cameraTarget);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(viewportRef.current.width, viewportRef.current.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight("#b8c4ff", 0.85);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight("#eef3ff", 1.4);
    keyLight.position.set(5.4, 8.2, 6.8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 24;
    keyLight.shadow.camera.left = -6;
    keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 6;
    keyLight.shadow.camera.bottom = -6;
    scene.add(keyLight);

    const fillLight = new THREE.PointLight("#6aa9ff", 1.1, 26, 2);
    fillLight.position.set(-5.5, 3.4, 3.8);
    scene.add(fillLight);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(8, 80),
      new THREE.MeshStandardMaterial({
        color: "#05070b",
        roughness: 0.92,
        metalness: 0.06,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(2.9, 3.2, 0.36, 48),
      new THREE.MeshStandardMaterial({
        color: "#0e1118",
        metalness: 0.22,
        roughness: 0.58,
      }),
    );
    platform.position.y = 0.18;
    platform.receiveShadow = true;
    platform.castShadow = true;
    scene.add(platform);

    const tableTop = new THREE.Mesh(
      new THREE.CylinderGeometry(2.72, 2.72, 0.12, 40),
      new THREE.MeshStandardMaterial({
        color: "#171b24",
        metalness: 0.2,
        roughness: 0.44,
      }),
    );
    tableTop.position.y = 0.42;
    tableTop.receiveShadow = true;
    tableTop.castShadow = true;
    scene.add(tableTop);

    const grid = new THREE.GridHelper(10, 16, "#253142", "#11161f");
    grid.position.y = 0.01;
    grid.material.opacity = 0.2;
    grid.material.transparent = true;
    scene.add(grid);

    objectEntriesRef.current = NBV_OBJECTS.map((spec) => createObject(scene, spec));
    candidateLookupRef.current = new Map(CANDIDATE_VIEWS.map((item) => [item.id, item]));
    candidateMeshesRef.current = new Map();
    CANDIDATE_VIEWS.forEach((candidate) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 16, 16),
        new THREE.MeshBasicMaterial({
          color: "#97baff",
          transparent: true,
          opacity: 0.34,
        }),
      );
      marker.position.set(...candidate.position);
      scene.add(marker);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.3, 32),
        new THREE.MeshBasicMaterial({
          color: "#5e8cff",
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
        }),
      );
      halo.rotation.x = Math.PI / 2;
      halo.position.set(candidate.position[0], candidate.position[1] - 0.2, candidate.position[2]);
      scene.add(halo);
      marker.add(halo);
      candidateMeshesRef.current.set(candidate.id, marker);
    });

    const robotArmBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.42, 0.42, 24),
      new THREE.MeshStandardMaterial({
        color: "#232a33",
        metalness: 0.58,
        roughness: 0.34,
      }),
    );
    robotArmBase.position.set(-4.9, 0.22, 4.9);
    scene.add(robotArmBase);

    const armGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-4.9, 0.22, 4.9),
      new THREE.Vector3(-3.5, 2.4, 3.4),
      new THREE.Vector3(-2.1, 3.3, 2),
      new THREE.Vector3(...CANDIDATE_VIEWS[0].position),
    ]);
    const robotArm = new THREE.Line(
      armGeometry,
      new THREE.LineBasicMaterial({
        color: "#92b4ff",
        transparent: true,
        opacity: 0.7,
      }),
    );
    scene.add(robotArm);
    robotArmLineRef.current = robotArm;

    const guideLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...CANDIDATE_VIEWS[0].position),
        new THREE.Vector3(...CANDIDATE_VIEWS[0].position),
      ]),
      new THREE.LineDashedMaterial({
        color: "#f7c66a",
        dashSize: 0.3,
        gapSize: 0.2,
        transparent: true,
        opacity: 0.7,
      }),
    );
    guideLine.computeLineDistances();
    scene.add(guideLine);
    guideLineRef.current = guideLine;

    const sensorRig = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.18, 0.4),
      new THREE.MeshStandardMaterial({
        color: "#dce6ff",
        emissive: "#6d8dff",
        emissiveIntensity: 0.4,
        roughness: 0.28,
        metalness: 0.56,
      }),
    );
    sensorRig.castShadow = true;
    scene.add(sensorRig);
    sensorRigRef.current = sensorRig;

    const frustum = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.ConeGeometry(0.72, 1.5, 4, 1, true)),
      new THREE.LineBasicMaterial({
        color: "#6ec2ff",
        transparent: true,
        opacity: 0.44,
      }),
    );
    scene.add(frustum);
    guideConeRef.current = frustum;

    let lastFrame = performance.now();
    const tempRaycaster = new THREE.Raycaster();
    const tempPoint = new THREE.Vector3();
    const sampleOffsets = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.18, 0),
      new THREE.Vector3(0.18, 0, 0),
      new THREE.Vector3(-0.18, 0, 0),
      new THREE.Vector3(0, 0, 0.18),
      new THREE.Vector3(0, 0, -0.18),
    ];

    const render = (now: number) => {
      const delta = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;

      const activeCandidate = currentCandidate(activeViewIdRef.current);
      const targetCandidate = currentCandidate(targetViewIdRef.current);
      const bestCandidate = currentCandidate(bestViewIdRef.current);
      const cameraTargetPosition = new THREE.Vector3(...targetCandidate.position);
      currentCameraPositionRef.current.lerp(cameraTargetPosition, 0.038);
      camera.position.copy(currentCameraPositionRef.current);
      camera.lookAt(cameraTarget);

      const armPoints = [
        new THREE.Vector3(-4.9, 0.22, 4.9),
        new THREE.Vector3(-3.7, 2.4, 3.35),
        new THREE.Vector3(-2.2, 3.5, 2.05),
        currentCameraPositionRef.current.clone(),
      ];
      robotArm.geometry.setFromPoints(armPoints);

      guideLine.geometry.setFromPoints([
        new THREE.Vector3(...activeCandidate.position),
        new THREE.Vector3(...bestCandidate.position),
      ]);
      guideLine.computeLineDistances();

      sensorRig.position.copy(currentCameraPositionRef.current);
      sensorRig.lookAt(cameraTarget);
      if (guideConeRef.current) {
        guideConeRef.current.position.copy(currentCameraPositionRef.current);
        guideConeRef.current.lookAt(cameraTarget);
        guideConeRef.current.rotateX(Math.PI / 2);
      }

      const objectMeshes = objectEntriesRef.current.map((entry) => entry.mesh);
      const activePosition = new THREE.Vector3(...activeCandidate.position);
      const viewScores = CANDIDATE_VIEWS.map((candidate) => {
        const candidatePosition = new THREE.Vector3(...candidate.position);
        let score = 0;
        let visibleCount = 0;

        objectEntriesRef.current.forEach((entry) => {
          const samplesVisible = sampleOffsets.reduce((visible, offset) => {
            tempPoint.copy(entry.mesh.position);
            const scaledOffset = offset.clone().multiplyScalar(Math.max(...entry.spec.size) * 0.72);
            tempPoint.add(scaledOffset);
            const direction = tempPoint.clone().sub(candidatePosition);
            const distanceToPoint = direction.length();
            tempRaycaster.set(candidatePosition, direction.normalize());
            const hits = tempRaycaster.intersectObjects(objectMeshes, false);
            const firstHit = hits.find((hit) => hit.distance <= distanceToPoint + 0.02);
            return visible + (firstHit?.object === entry.mesh ? 1 : 0);
          }, 0);

          const visibility = samplesVisible / sampleOffsets.length;
          if (visibility > 0.25) {
            visibleCount += 1;
          }

          const travelPenalty = candidatePosition.distanceTo(activePosition) * 0.04;
          score += visibility * entry.uncertainty * (1 - travelPenalty * 0.12);
        });

        return {
          candidate,
          score: Math.max(score, 0),
          visibleCount,
        };
      }).sort((left, right) => right.score - left.score);

      const nextBest = viewScores[0] ?? { candidate: CANDIDATE_VIEWS[0], score: 0, visibleCount: 0 };
      bestViewIdRef.current = nextBest.candidate.id;
      if (now > viewSwitchArmedAtRef.current && !grabbedIdRef.current) {
        targetViewIdRef.current = nextBest.candidate.id;
        viewSwitchArmedAtRef.current = now + 2200;
      }

      if (currentCameraPositionRef.current.distanceTo(cameraTargetPosition) < 0.12) {
        activeViewIdRef.current = targetViewIdRef.current;
      }

      objectEntriesRef.current.forEach((entry) => {
        const direction = entry.mesh.position.clone().sub(activePosition);
        const distanceToObject = direction.length();
        tempRaycaster.set(activePosition, direction.normalize());
        const hits = tempRaycaster.intersectObjects(objectMeshes, false);
        const visible =
          hits.find((hit) => hit.distance <= distanceToObject + 0.02)?.object === entry.mesh ? 1 : 0;

        entry.uncertainty = clamp(
          entry.uncertainty - visible * delta * 0.18 + (1 - visible) * delta * 0.015,
          0.08,
          1,
        );

        const hovered = hoveredIdRef.current === entry.spec.id;
        const grabbed = grabbedIdRef.current === entry.spec.id;
        entry.material.emissive.set(grabbed ? "#ffe0a6" : hovered ? "#7ebeff" : "#05070a");
        entry.material.emissiveIntensity = grabbed ? 0.62 : hovered ? 0.42 : 0.18;
        entry.mesh.scale.lerp(
          new THREE.Vector3(grabbed ? 1.06 : hovered ? 1.03 : 1, grabbed ? 1.06 : hovered ? 1.03 : 1, grabbed ? 1.06 : hovered ? 1.03 : 1),
          0.12,
        );
        (entry.halo.material as THREE.MeshBasicMaterial).opacity = grabbed
          ? 0.26
          : hovered
            ? 0.18
            : 0.08 + entry.uncertainty * 0.04;
      });

      candidateMeshesRef.current.forEach((mesh, id) => {
        const isBest = id === bestViewIdRef.current;
        const isActive = id === activeViewIdRef.current;
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.color.set(isBest ? "#f7c66a" : isActive ? "#7fdcff" : "#97baff");
        material.opacity = isBest ? 0.92 : isActive ? 0.78 : 0.34;
        mesh.scale.lerp(
          new THREE.Vector3(isBest ? 1.42 : isActive ? 1.26 : 1, isBest ? 1.42 : isActive ? 1.26 : 1, isBest ? 1.42 : isActive ? 1.26 : 1),
          0.16,
        );
      });

      const hoveredHit = grabbedIdRef.current ? null : intersectPointerMesh();
      const hoveredId = hoveredHit?.object.userData.objectId ?? null;
      hoveredIdRef.current = hoveredId;

      if (now - hudPublishAtRef.current > HUD_PUBLISH_MS) {
        hudPublishAtRef.current = now;
        const totalUncertainty = objectEntriesRef.current.reduce((sum, entry) => sum + entry.uncertainty, 0);
        setHud({
          activeView: activeCandidate.label,
          bestView: nextBest.candidate.label,
          bestGain: nextBest.score,
          movementHint: movementHint(activeCandidate, nextBest.candidate),
          visibleCount: nextBest.visibleCount,
          totalUncertainty,
          hoveredId,
          grabbedId: grabbedIdRef.current,
          uncertainties: objectEntriesRef.current
            .map((entry) => ({
              id: entry.spec.id,
              name: entry.spec.name,
              semanticClass: entry.spec.semanticClass,
              value: entry.uncertainty,
            }))
            .sort((left, right) => right.value - left.value),
        });
      }

      renderer.render(scene, camera);
      threeFrameRef.current = window.requestAnimationFrame(render);
    };

    threeFrameRef.current = window.requestAnimationFrame(render);

    return () => {
      if (threeFrameRef.current) {
        cancelAnimationFrame(threeFrameRef.current);
      }
      objectEntriesRef.current.forEach((entry) => {
        entry.mesh.geometry.dispose();
        entry.material.dispose();
        (entry.halo.geometry as THREE.BufferGeometry).dispose();
        (entry.halo.material as THREE.Material).dispose();
      });
      candidateMeshesRef.current.forEach((mesh) => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      robotArm.geometry.dispose();
      (robotArm.material as THREE.Material).dispose();
      guideLine.geometry.dispose();
      (guideLine.material as THREE.Material).dispose();
      sensorRig.geometry.dispose();
      (sensorRig.material as THREE.Material).dispose();
      guideConeRef.current?.geometry.dispose();
      (guideConeRef.current?.material as THREE.Material | undefined)?.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      candidateMeshesRef.current.clear();
      objectEntriesRef.current = [];
    };
  }, [cameraTarget]);

  useEffect(() => {
    let mounted = true;
    let stream: MediaStream | null = null;
    let handLandmarker: Awaited<
      ReturnType<VisionModule["HandLandmarker"]["createFromOptions"]>
    > | null = null;

    async function setup() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch {
        if (mounted) {
          setSensorState("camera-blocked");
          setStatusLabel("Camera access blocked");
        }
        return;
      }

      if (!mounted || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      await videoRef.current.play().catch(() => undefined);

      if (!lightCanvasRef.current) {
        lightCanvasRef.current = document.createElement("canvas");
      }

      const vision = await loadVisionModule("/vendor/mediapipe/vision_bundle.mjs");
      const resolver = await vision.FilesetResolver.forVisionTasks("/vendor/mediapipe");

      try {
        handLandmarker = await vision.HandLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath: "/vendor/mediapipe/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });
      } catch {
        handLandmarker = await vision.HandLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath: "/vendor/mediapipe/hand_landmarker.task",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });
      }

      if (!mounted) {
        handLandmarker?.close();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const loop = () => {
        if (!videoRef.current || !handLandmarker) {
          return;
        }

        const now = performance.now();
        brightnessSampleFrameRef.current += 1;
        if (lightCanvasRef.current && brightnessSampleFrameRef.current % 12 === 0) {
          brightnessRef.current = estimateBrightness(videoRef.current, lightCanvasRef.current);
        }

        const result = handLandmarker.detectForVideo(videoRef.current, now);
        const hands = result.landmarks;
        const { rightHand, leftHand } = splitHandsBySide(hands, result.handedness);
        const pointerHand = rightHand ?? getLargestHand(hands);
        const actionHand = leftHand;
        const rightPinched = pointerHand ? isPinched(pointerHand) : false;
        const leftPinched = actionHand ? isPinched(actionHand) : false;

        drawPreview(
          previewCanvasRef.current,
          videoRef.current,
          hands,
          pointerHand,
          actionHand,
          rightPinched,
          leftPinched,
        );

        if (!pointerHand) {
          grabbedIdRef.current = null;
          rightPinchedRef.current = false;
          leftPinchedRef.current = false;
          hoveredIdRef.current = null;
          setSensorState(brightnessRef.current < LOW_LIGHT_THRESHOLD ? "low-light" : "searching");
          setStatusLabel(
            brightnessRef.current < LOW_LIGHT_THRESHOLD ? "Low light" : "Searching for hands",
          );
          trackingFrameRef.current = requestAnimationFrame(loop);
          return;
        }

        const targetPointer = mapPointer(
          pointerHand[8],
          viewportRef.current.width,
          viewportRef.current.height,
          getHandScale(pointerHand),
        );
        pointerRef.current = {
          x: pointerRef.current.x + (targetPointer.x - pointerRef.current.x) * POINTER_SMOOTHING,
          y: pointerRef.current.y + (targetPointer.y - pointerRef.current.y) * POINTER_SMOOTHING,
        };
        pointerNdcRef.current.set(
          (pointerRef.current.x / viewportRef.current.width) * 2 - 1,
          -(pointerRef.current.y / viewportRef.current.height) * 2 + 1,
        );
        setPointer(pointerRef.current);

        const leftClustered = actionHand ? isHandClustered(actionHand) : false;
        const rightClustered = isHandClustered(pointerHand);
        const bothOpen = Boolean(actionHand && isOpenPalm(actionHand) && isOpenPalm(pointerHand));

        if (leftPinched && !leftPinchedRef.current && now > viewSwitchArmedAtRef.current) {
          targetViewIdRef.current = bestViewIdRef.current;
          viewSwitchArmedAtRef.current = now + VIEW_SWITCH_COOLDOWN_MS;
        }
        leftPinchedRef.current = leftPinched;

        if (rightPinched && !rightPinchedRef.current) {
          const hit = intersectPointerMesh();
          const grabbedId = hit?.object.userData.objectId as string | undefined;
          if (grabbedId) {
            const entry = objectEntriesRef.current.find((item) => item.spec.id === grabbedId);
            if (entry) {
              grabbedIdRef.current = grabbedId;
              grabPlaneRef.current.set(new THREE.Vector3(0, 1, 0), -entry.mesh.position.y);
              grabOffsetRef.current.copy(entry.mesh.position).sub(hit?.point ?? entry.mesh.position);
              viewSwitchArmedAtRef.current = now + VIEW_SWITCH_COOLDOWN_MS;
            }
          }
        } else if (!rightPinched && rightPinchedRef.current) {
          grabbedIdRef.current = null;
        }
        rightPinchedRef.current = rightPinched;

        if (rightPinched && grabbedIdRef.current) {
          const entry = objectEntriesRef.current.find((item) => item.spec.id === grabbedIdRef.current);
          const camera = cameraRef.current;
          if (entry && camera) {
            raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
            const hitPoint = raycasterRef.current.ray.intersectPlane(grabPlaneRef.current, new THREE.Vector3());
            if (hitPoint) {
              const next = hitPoint.add(grabOffsetRef.current);
              entry.mesh.position.x = clamp(next.x, -2.1, 2.1);
              entry.mesh.position.z = clamp(next.z, -2.1, 2.1);
              entry.uncertainty = clamp(entry.uncertainty + 0.02, 0.08, 1);
            }
          }
        }

        if (leftClustered && rightClustered) {
          if (!menuReturnArmedAtRef.current) {
            menuReturnArmedAtRef.current = now;
          } else if (now - menuReturnArmedAtRef.current >= MENU_RETURN_HOLD_MS) {
            sessionStorage.setItem(GLOBAL_MENU_FLAG_KEY, "1");
            router.push("/");
            return;
          }
        } else {
          menuReturnArmedAtRef.current = null;
        }

        setSensorState(brightnessRef.current < LOW_LIGHT_THRESHOLD ? "low-light" : "tracking");
        setStatusLabel(
          brightnessRef.current < LOW_LIGHT_THRESHOLD
            ? "Low light"
            : grabbedIdRef.current
              ? "Right pinch grasp active"
              : bothOpen
                ? "Hands ready"
                : "NBV simulation live",
        );

        trackingFrameRef.current = requestAnimationFrame(loop);
      };

      trackingFrameRef.current = requestAnimationFrame(loop);
    }

    setup();

    return () => {
      mounted = false;
      if (trackingFrameRef.current) {
        cancelAnimationFrame(trackingFrameRef.current);
      }
      handLandmarker?.close();
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [router]);

  const focusedObject = objectLookup[hud.grabbedId ?? hud.hoveredId ?? ""] ?? null;
  const currentView = CANDIDATE_VIEWS.find((item) => item.label === hud.activeView) ?? CANDIDATE_VIEWS[0];
  const bestView = CANDIDATE_VIEWS.find((item) => item.label === hud.bestView) ?? CANDIDATE_VIEWS[0];
  const cameraPoint =
    cameraRef.current && sceneRef.current
      ? projectToScreen(currentCameraPositionRef.current.clone(), cameraRef.current, viewportRef.current.width, viewportRef.current.height)
      : null;
  const bestPoint =
    cameraRef.current && sceneRef.current
      ? projectToScreen(new THREE.Vector3(...bestView.position), cameraRef.current, viewportRef.current.width, viewportRef.current.height)
      : null;

  return (
    <main className={styles.shell}>
      <div ref={mountRef} className={styles.viewport} />
      <div className={styles.vignette} />

      <div
        className={styles.reticle}
        style={{ transform: `translate3d(${pointer.x}px, ${pointer.y}px, 0)` }}
      >
        <div className={styles.reticleCore} />
      </div>

      <header className={styles.topBar}>
        <Link href="/" className={styles.backLink}>
          Return to dock
        </Link>
        <div className={styles.modePill}>NBV / single-view semantic simulation</div>
      </header>

      <section className={styles.leftDock}>
        <div className={styles.panel}>
          <p className={styles.panelEyebrow}>Current sensor view</p>
          <h1 className={styles.panelTitle}>NBV Robotics Lab</h1>
          <p className={styles.panelCopy}>
            Occluded tabletop scene, robot-arm camera viewpoints, information gain scoring, and
            right-hand grasp-driven rearrangement.
          </p>
          <div className={styles.metrics}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Active</span>
              <strong>{hud.activeView}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Best next</span>
              <strong>{hud.bestView}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Info gain</span>
              <strong>{hud.bestGain.toFixed(2)}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Visible objects</span>
              <strong>{hud.visibleCount} / {NBV_OBJECTS.length}</strong>
            </div>
          </div>
        </div>

        <div className={styles.panel}>
          <p className={styles.panelEyebrow}>Movement cue</p>
          <div className={styles.directionRow}>
            <div>
              <h2 className={styles.sectionTitle}>{currentView.label} → {bestView.label}</h2>
              <p className={styles.directionCopy}>{bestView.emphasis}</p>
            </div>
            <span className={styles.directionBadge}>{hud.movementHint}</span>
          </div>
          <p className={styles.panelCopy}>
            Left pinch snaps the sensor rig to the current best next view. Right pinch on an object
            grasps and moves it to reduce occlusion.
          </p>
        </div>
      </section>

      <aside className={styles.rightDock}>
        <div className={styles.panel}>
          <p className={styles.panelEyebrow}>Uncertainty field</p>
          <div className={styles.uncertaintyList}>
            {hud.uncertainties.map((item) => (
              <div key={item.id} className={styles.uncertaintyRow}>
                <div className={styles.uncertaintyHead}>
                  <span>{item.name}</span>
                  <span>{item.value.toFixed(2)}</span>
                </div>
                <div className={styles.barTrack}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${item.value * 100}%` }}
                  />
                </div>
                <span className={styles.uncertaintyMeta}>{item.semanticClass}</span>
              </div>
            ))}
          </div>
          <div className={styles.totalRow}>
            <span>Total uncertainty</span>
            <strong>{hud.totalUncertainty.toFixed(2)}</strong>
          </div>
        </div>

        <div className={styles.panel}>
          <p className={styles.panelEyebrow}>Focused object</p>
          {focusedObject ? (
            <>
              <h2 className={styles.sectionTitle}>{focusedObject.name}</h2>
              <p className={styles.panelCopy}>{focusedObject.description}</p>
              <div className={styles.noteBlock}>
                <span className={styles.noteLabel}>Grasp</span>
                <span>{focusedObject.graspNote}</span>
              </div>
            </>
          ) : (
            <p className={styles.panelCopy}>
              Hover an object with the right-hand pointer. Pinch to grasp and relocate it.
            </p>
          )}
        </div>
      </aside>

      {cameraPoint && bestPoint && cameraPoint.visible && bestPoint.visible ? (
        <svg className={styles.guideOverlay} aria-hidden="true">
          <line
            x1={cameraPoint.x}
            y1={cameraPoint.y}
            x2={bestPoint.x}
            y2={bestPoint.y}
            className={styles.guideLine}
          />
        </svg>
      ) : null}

      <div className={styles.statusDock}>
        <span
          className={`${styles.statusDot} ${
            sensorState === "camera-blocked"
              ? styles.statusDotBlocked
              : sensorState === "low-light"
                ? styles.statusDotWarning
                : styles.statusDotLive
          }`}
          aria-hidden="true"
        />
        <span className={styles.statusLabel}>{statusLabel}</span>
      </div>

      <div className={styles.previewDock}>
        <video ref={videoRef} className={styles.previewVideo} autoPlay muted playsInline />
        <canvas ref={previewCanvasRef} className={styles.previewCanvas} />
      </div>
    </main>
  );
}
