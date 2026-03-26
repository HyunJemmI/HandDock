"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import styles from "./NBVRoboticsExperience.module.css";
import {
  FINGERTIP_INDICES,
  type Landmark,
  type VisionModule,
  clamp,
  clamp01,
  distance,
  getHandScale,
  getLargestHand,
  isHandClustered,
  loadVisionModule,
  splitHandsBySide,
} from "./hand-tracking";

type SensorState = "tracking" | "searching" | "camera-blocked" | "low-light";
type ShapeType = "box" | "cylinder";
type PlannerStage =
  | "manual"
  | "auto-scan"
  | "pose-estimation"
  | "pile-disturbance"
  | "auto-grasp"
  | "complete";

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
  graspWidth: number;
  priorityViews: string[];
};

type CandidateViewSpec = {
  id: string;
  label: string;
  position: [number, number, number];
};

type ViewOrbit = {
  yaw: number;
  pitch: number;
  zoom: number;
};

type ViewPan = {
  x: number;
  y: number;
};

type RuntimeObject = {
  spec: SceneObjectSpec;
  group: THREE.Group;
  primaryMesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  halo: THREE.Mesh;
  uncertainty: number;
  planProgress: number;
  graspScore: number;
  graspReady: boolean;
  grasped: boolean;
  poseAttempts: number;
  poseSolved: boolean;
  bestViewId: string;
  dropSlot: number | null;
};

type ObjectLabel = {
  id: string;
  name: string;
  semanticClass: string;
  confidence: number;
  x: number;
  y: number;
  visible: boolean;
  priority: boolean;
  hovered: boolean;
  grasped: boolean;
  ready: boolean;
};

type PlannerInfo = {
  stage: PlannerStage;
  stageLabel: string;
  activeView: string;
  bestView: string;
  priorityTarget: string | null;
};

type AutoGraspTask = {
  id: string;
  phase: "approach" | "lift" | "carry" | "drop";
  phaseStartedAt: number;
  startEffector: THREE.Vector3;
  hoverPosition: THREE.Vector3;
  liftPosition: THREE.Vector3;
  carryPosition: THREE.Vector3;
  dropPosition: THREE.Vector3;
  objectStart: THREE.Vector3;
};

type DisturbanceTask = {
  targetId: string;
  phase: "approach" | "sweep" | "reset";
  phaseStartedAt: number;
  startEffector: THREE.Vector3;
  approachPosition: THREE.Vector3;
  sweepStart: THREE.Vector3;
  sweepEnd: THREE.Vector3;
  resetPosition: THREE.Vector3;
};

const CURSOR_GAIN_X = 1.72;
const CURSOR_GAIN_Y = 1.56;
const POINTER_SMOOTHING = 0.34;
const LOW_LIGHT_THRESHOLD = 40;
const PINCH_THRESHOLD = 0.46;
const EXIT_HOLD_MS = 220;
const LABEL_PUBLISH_MS = 120;
const MAX_GRIPPER_WIDTH = 0.88;
const IDEAL_GRIPPER_WIDTH = 0.54;
const EXIT_BUTTON_ID = "exit-button";
const SPEED_CONTROL_ID = "speed-control";
const SPEED_MIN = 0.5;
const SPEED_MAX = 2;
const POSE_ATTEMPT_INTERVAL_MS = 720;
const FINGERTIP_COLORS = ["#f7c66a", "#8af4dd", "#f4f7fb", "#f39bd8", "#78b9ff"];

const SCENE_OBJECTS: SceneObjectSpec[] = [
  {
    id: "toy-car",
    name: "장난감 자동차",
    semanticClass: "car",
    description:
      "전면 좌측에 놓인 자동차 장난감이다. 차체가 낮지만 폭이 넓어서 옆 시점에서 grasp 폭 추정이 더 안정적이다.",
    graspNote: "좌측 또는 상단 시점에서 wheel 간 간섭 없이 접근하는 편이 좋다.",
    shape: "box",
    color: "#7aa3ff",
    size: [1.14, 0.34, 0.66],
    position: [-1.18, 0.61, 0.34],
    initialUncertainty: 0.82,
    graspWidth: 0.68,
    priorityViews: ["front-left", "left-high"],
  },
  {
    id: "mug",
    name: "머그컵",
    semanticClass: "cup",
    description:
      "컵 손잡이 때문에 정면 분할만으로는 grasp 방향을 오해하기 쉽다. 상단 또는 우측 시점이 손잡이 분리를 도와준다.",
    graspNote: "손잡이 반대 방향에서 집게를 넣는 접근이 가장 안전하다.",
    shape: "cylinder",
    color: "#e8eef8",
    size: [0.34, 0.62, 0.34],
    position: [0.82, 0.74, -0.18],
    initialUncertainty: 0.9,
    graspWidth: 0.46,
    priorityViews: ["front-right", "top-sweep"],
  },
  {
    id: "cereal-box",
    name: "시리얼 박스",
    semanticClass: "box",
    description:
      "세로로 세워 둔 박스형 물체다. 뒤쪽 물체를 가리는 대표적인 occluder라서 view planning에 큰 영향을 준다.",
    graspNote: "상단에서 모서리를 잡거나 측면 중심을 잡는 방식이 안정적이다.",
    shape: "box",
    color: "#ffb356",
    size: [0.74, 1.22, 0.42],
    position: [0.14, 1.04, 0.5],
    initialUncertainty: 0.86,
    graspWidth: 0.58,
    priorityViews: ["front-left", "rear-arc"],
  },
  {
    id: "toy-camera",
    name: "토이 카메라",
    semanticClass: "camera",
    description:
      "렌즈가 전방으로 돌출된 소형 카메라 모형이다. 위쪽 사선 view에서 body와 lens를 분리해 보기 쉽다.",
    graspNote: "렌즈를 피해서 body 양옆을 집는 grasp plan이 선호된다.",
    shape: "box",
    color: "#a56cff",
    size: [0.68, 0.42, 0.36],
    position: [-0.26, 0.66, -0.84],
    initialUncertainty: 0.92,
    graspWidth: 0.52,
    priorityViews: ["left-high", "top-sweep"],
  },
  {
    id: "spray-bottle",
    name: "스프레이 병",
    semanticClass: "bottle",
    description:
      "길쭉한 병체와 노즐이 있는 물체다. 우측 후방 시점에서 목 부분의 분할 confidence가 빨리 올라간다.",
    graspNote: "노즐이 아닌 병 몸통을 중심으로 잡는 계획이 필요하다.",
    shape: "cylinder",
    color: "#64c2ff",
    size: [0.28, 1.02, 0.28],
    position: [1.22, 0.82, -0.72],
    initialUncertainty: 0.88,
    graspWidth: 0.34,
    priorityViews: ["right-high", "rear-arc"],
  },
  {
    id: "drink-can",
    name: "음료 캔",
    semanticClass: "can",
    description:
      "중앙 하단에 숨어 있는 캔이다. 상단 시점에서만 다른 물체와 분리된 contour가 또렷해진다.",
    graspNote: "얇은 원통이라 좁은 집게 폭을 유지해야 한다.",
    shape: "cylinder",
    color: "#7de0b1",
    size: [0.24, 0.5, 0.24],
    position: [-0.02, 0.5, -0.2],
    initialUncertainty: 0.94,
    graspWidth: 0.28,
    priorityViews: ["top-sweep", "front-left"],
  },
  {
    id: "tissue-box",
    name: "티슈 박스",
    semanticClass: "box",
    description:
      "상단 우측에 걸쳐 있는 낮은 직육면체 박스다. 뒤쪽 컵과 병을 가리는 추가 occluder 역할을 한다.",
    graspNote: "상단에서 모서리 grasp를 먼저 추정한 뒤 측면으로 접근하는 편이 좋다.",
    shape: "box",
    color: "#ffd2d2",
    size: [0.82, 0.32, 0.44],
    position: [0.94, 0.58, 0.62],
    initialUncertainty: 0.89,
    graspWidth: 0.62,
    priorityViews: ["front-right", "right-high"],
  },
  {
    id: "thermos",
    name: "텀블러",
    semanticClass: "bottle",
    description:
      "중앙 좌측 뒤편에 세워진 원통형 텀블러다. 앞의 자동차와 박스에 가려져 측면 silhouette 확보가 늦다.",
    graspNote: "원통 body 중심을 따라 좁은 2-finger grasp를 잡는 것이 안정적이다.",
    shape: "cylinder",
    color: "#8ad0ff",
    size: [0.22, 0.88, 0.22],
    position: [-0.74, 0.8, -0.18],
    initialUncertainty: 0.91,
    graspWidth: 0.3,
    priorityViews: ["left-high", "rear-arc"],
  },
  {
    id: "soap-box",
    name: "비누 박스",
    semanticClass: "package",
    description:
      "중앙 전방에 눕혀 둔 소형 패키지다. 작은 크기 때문에 confidence는 빨리 오르지만 pose estimation이 흔들리기 쉽다.",
    graspNote: "정면보다는 상단 sweep에서 모서리 축을 먼저 고정하는 편이 좋다.",
    shape: "box",
    color: "#d2c1ff",
    size: [0.48, 0.2, 0.3],
    position: [0.38, 0.52, -0.52],
    initialUncertainty: 0.93,
    graspWidth: 0.36,
    priorityViews: ["top-sweep", "front-right"],
  },
  {
    id: "jar",
    name: "유리 병",
    semanticClass: "jar",
    description:
      "뒤쪽 중앙에 놓인 낮은 병이다. 앞쪽 박스와 컵 뒤에 숨어 있어 top sweep 이후에야 contour가 분리된다.",
    graspNote: "짧은 원통이라 위에서 윤곽을 따고, 이후 옆면 중심으로 접근하는 계획이 필요하다.",
    shape: "cylinder",
    color: "#c7ffe0",
    size: [0.26, 0.46, 0.26],
    position: [0.04, 0.56, 0.86],
    initialUncertainty: 0.95,
    graspWidth: 0.24,
    priorityViews: ["top-sweep", "rear-arc"],
  },
];

const CANDIDATE_VIEWS: CandidateViewSpec[] = [
  { id: "front-left", label: "View A", position: [-4.8, 2.8, 4.8] },
  { id: "front-right", label: "View B", position: [4.9, 2.8, 4.1] },
  { id: "left-high", label: "View C", position: [-5.5, 4.1, 0.7] },
  { id: "right-high", label: "View D", position: [5.4, 4.0, 0.2] },
  { id: "rear-arc", label: "View E", position: [0.4, 3.0, -5.2] },
  { id: "top-sweep", label: "View F", position: [0.1, 5.9, 2.4] },
];

function clampConfidence(value: number) {
  return Math.round(clamp01(value) * 100);
}

function lerp(start: number, end: number, alpha: number) {
  return start + (end - start) * alpha;
}

function handAnchor(points: Landmark[]) {
  return points[9];
}

function buildCameraPose(candidate: CandidateViewSpec, pan: ViewPan, orbit: ViewOrbit) {
  const target = new THREE.Vector3(pan.x, 0.82 + pan.y, 0);
  const offset = new THREE.Vector3(candidate.position[0], candidate.position[1] - 0.82, candidate.position[2])
    .applyEuler(new THREE.Euler(orbit.pitch, orbit.yaw, 0, "YXZ"))
    .multiplyScalar(orbit.zoom);

  return {
    target,
    position: target.clone().add(offset),
  };
}

function resolveObjectId(node: THREE.Object3D | null) {
  let current: THREE.Object3D | null = node;

  while (current) {
    const objectId = current.userData.objectId;
    if (typeof objectId === "string") {
      return objectId;
    }
    current = current.parent;
  }

  return null;
}

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
  leftDragging: boolean,
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
    const anchor = handAnchor(actionHand);
    context.beginPath();
    context.moveTo(actionHand[4].x * canvas.width, actionHand[4].y * canvas.height);
    context.lineTo(actionHand[8].x * canvas.width, actionHand[8].y * canvas.height);
    context.lineWidth = 4;
    context.strokeStyle = leftPinched
      ? "rgba(123, 236, 220, 0.94)"
      : leftDragging
        ? "rgba(141, 191, 255, 0.92)"
        : "rgba(255, 255, 255, 0.26)";
    context.stroke();

    if (leftDragging) {
      context.beginPath();
      context.fillStyle = "rgba(141, 191, 255, 0.9)";
      context.arc(anchor.x * canvas.width, anchor.y * canvas.height, 10, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function createPrimaryMesh(spec: SceneObjectSpec, material: THREE.MeshStandardMaterial) {
  if (spec.shape === "cylinder") {
    return new THREE.Mesh(new THREE.CylinderGeometry(spec.size[0], spec.size[0], spec.size[1], 32), material);
  }

  return new THREE.Mesh(new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]), material);
}

function addDecoration(spec: SceneObjectSpec, group: THREE.Group, material: THREE.MeshStandardMaterial) {
  if (spec.id === "toy-car") {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(spec.size[0] * 0.42, spec.size[1] * 0.7, spec.size[2] * 0.58),
      material.clone(),
    );
    roof.position.set(0.08, spec.size[1] * 0.42, 0);
    roof.material = (roof.material as THREE.MeshStandardMaterial).clone();
    (roof.material as THREE.MeshStandardMaterial).color.set("#c7d8ff");
    group.add(roof);

    const wheelMaterial = new THREE.MeshStandardMaterial({
      color: "#171b25",
      roughness: 0.76,
      metalness: 0.1,
    });
    [
      [-0.34, -spec.size[1] * 0.28, -0.22],
      [0.34, -spec.size[1] * 0.28, -0.22],
      [-0.34, -spec.size[1] * 0.28, 0.22],
      [0.34, -spec.size[1] * 0.28, 0.22],
    ].forEach(([x, y, z]) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 20), wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, y, z);
      group.add(wheel);
    });
  }

  if (spec.id === "mug") {
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.14, 0.04, 14, 24, Math.PI * 1.25),
      new THREE.MeshStandardMaterial({
        color: "#dce8f8",
        roughness: 0.46,
        metalness: 0.16,
      }),
    );
    handle.rotation.z = Math.PI / 2;
    handle.position.set(spec.size[0] * 0.74, 0.02, 0);
    group.add(handle);
  }

  if (spec.id === "toy-camera") {
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.24, 28),
      new THREE.MeshStandardMaterial({
        color: "#0f1624",
        roughness: 0.34,
        metalness: 0.48,
      }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0, spec.size[2] * 0.56);
    group.add(lens);

    const flash = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.08),
      new THREE.MeshStandardMaterial({
        color: "#f4f7fb",
        roughness: 0.18,
        metalness: 0.36,
      }),
    );
    flash.position.set(spec.size[0] * 0.22, spec.size[1] * 0.18, spec.size[2] * 0.1);
    group.add(flash);
  }

  if (spec.id === "spray-bottle") {
    const nozzle = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.12, 0.1),
      new THREE.MeshStandardMaterial({
        color: "#d7eefc",
        roughness: 0.22,
        metalness: 0.26,
      }),
    );
    nozzle.position.set(0.08, spec.size[1] * 0.55, 0);
    group.add(nozzle);

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.18, 20),
      (nozzle.material as THREE.MeshStandardMaterial).clone(),
    );
    neck.position.set(0, spec.size[1] * 0.42, 0);
    group.add(neck);
  }

  if (spec.id === "drink-can") {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.19, 0.02, 10, 28),
      new THREE.MeshStandardMaterial({
        color: "#f1f4f9",
        roughness: 0.22,
        metalness: 0.52,
      }),
    );
    band.rotation.x = Math.PI / 2;
    band.position.set(0, spec.size[1] * 0.38, 0);
    group.add(band);
  }
}

function createRuntimeObject(scene: THREE.Scene, spec: SceneObjectSpec) {
  const group = new THREE.Group();
  group.position.set(...spec.position);
  group.userData.objectId = spec.id;

  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.36,
    metalness: 0.42,
    emissive: "#020202",
    emissiveIntensity: 0.18,
  });

  const primaryMesh = createPrimaryMesh(spec, material);
  primaryMesh.castShadow = true;
  primaryMesh.receiveShadow = true;
  group.add(primaryMesh);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(primaryMesh.geometry),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.16,
    }),
  );
  primaryMesh.add(outline);

  addDecoration(spec, group, material);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(spec.size[0], spec.size[2]) * 0.76, Math.max(spec.size[0], spec.size[2]) * 0.96, 40),
    new THREE.MeshBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -spec.size[1] * 0.5 + 0.02;
  group.add(halo);

  group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  scene.add(group);

  return {
    spec,
    group,
    primaryMesh,
    material,
    halo,
    uncertainty: spec.initialUncertainty,
    planProgress: 0.12,
    graspScore: 0.18,
    graspReady: false,
    grasped: false,
    poseAttempts: 0,
    poseSolved: false,
    bestViewId: spec.priorityViews[0] ?? CANDIDATE_VIEWS[0].id,
    dropSlot: null,
  };
}

function objectSampleOffsets(spec: SceneObjectSpec) {
  const scale = Math.max(...spec.size) * 0.72;
  return [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, spec.size[1] * 0.22, 0),
    new THREE.Vector3(scale * 0.22, 0, 0),
    new THREE.Vector3(-scale * 0.22, 0, 0),
    new THREE.Vector3(0, 0, scale * 0.22),
    new THREE.Vector3(0, 0, -scale * 0.22),
  ];
}

function computeGraspability(spec: SceneObjectSpec, candidate: CandidateViewSpec) {
  const widthScore = clamp01(1 - Math.abs(spec.graspWidth - IDEAL_GRIPPER_WIDTH) / MAX_GRIPPER_WIDTH);
  const preferredBoost = spec.priorityViews.includes(candidate.id) ? 0.18 : 0;
  return clamp(widthScore + preferredBoost, 0.12, 1);
}

function worldToScreen(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number) {
  const projected = point.clone().project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
    visible:
      projected.z < 1 &&
      projected.z > -1 &&
      projected.x > -1.2 &&
      projected.x < 1.2 &&
      projected.y > -1.2 &&
      projected.y < 1.2,
  };
}

function disposeThreeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      if (Array.isArray(node.material)) {
        node.material.forEach((material) => material.dispose());
      } else {
        node.material.dispose();
      }
    }

    if (node instanceof THREE.Line || node instanceof THREE.LineSegments) {
      node.geometry.dispose();
      if (Array.isArray(node.material)) {
        node.material.forEach((material) => material.dispose());
      } else {
        node.material.dispose();
      }
    }
  });
}

export function NBVRoboticsExperience() {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const trackingFrameRef = useRef<number | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const viewportRef = useRef({ width: 1280, height: 720 });
  const pointerRef = useRef({ x: 0, y: 0 });
  const pointerNdcRef = useRef(new THREE.Vector2(0, 0));
  const brightnessRef = useRef(255);
  const brightnessSampleFrameRef = useRef(0);
  const objectEntriesRef = useRef<RuntimeObject[]>([]);
  const candidateMarkersRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const candidateLookupRef = useRef(new Map(CANDIDATE_VIEWS.map((view) => [view.id, view])));
  const currentCameraPositionRef = useRef(new THREE.Vector3(...CANDIDATE_VIEWS[0].position));
  const currentCameraTargetRef = useRef(new THREE.Vector3(0, 0.82, 0));
  const targetViewIdRef = useRef(CANDIDATE_VIEWS[0].id);
  const activeViewIdRef = useRef(CANDIDATE_VIEWS[0].id);
  const bestViewIdRef = useRef(CANDIDATE_VIEWS[0].id);
  const plannerStageRef = useRef<PlannerStage>("auto-scan");
  const hoveredIdRef = useRef<string | null>(null);
  const grabbedIdRef = useRef<string | null>(null);
  const manualPriorityIdRef = useRef<string | null>(null);
  const exitArmedAtRef = useRef<number | null>(null);
  const leftPinchedRef = useRef(false);
  const rightPinchedRef = useRef(false);
  const labelsPublishAtRef = useRef(0);
  const userPanRef = useRef<ViewPan>({ x: 0, y: 0 });
  const viewOrbitRef = useRef<ViewOrbit>({ yaw: 0, pitch: 0, zoom: 1 });
  const speedTrackRef = useRef<HTMLDivElement | null>(null);
  const speedRef = useRef(1);
  const speedDragRef = useRef(false);
  const poseAttemptRef = useRef<{ targetId: string | null; lastAttemptAt: number }>({
    targetId: null,
    lastAttemptAt: 0,
  });
  const leftDragRef = useRef({
    active: false,
    anchorX: 0,
    anchorY: 0,
    startYaw: 0,
    startPitch: 0,
  });
  const rightPanRef = useRef({
    active: false,
    anchorX: 0,
    anchorY: 0,
    startX: 0,
    startY: 0,
  });
  const pinchZoomRef = useRef({
    active: false,
    anchorDistance: 0,
    startZoom: 1,
  });
  const grabPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const grabOffsetRef = useRef(new THREE.Vector3());
  const autoTaskRef = useRef<AutoGraspTask | null>(null);
  const disturbanceTaskRef = useRef<DisturbanceTask | null>(null);
  const dropCountRef = useRef(0);
  const robotArmLineRef = useRef<THREE.Line | null>(null);
  const effectorGroupRef = useRef<THREE.Group | null>(null);
  const leftFingerRef = useRef<THREE.Mesh | null>(null);
  const rightFingerRef = useRef<THREE.Mesh | null>(null);
  const sensorFrustumRef = useRef<THREE.LineSegments | null>(null);
  const gripperOpenRef = useRef(0.52);
  const pointerVisibleRef = useRef(false);
  const objectLookup = useMemo(
    () => Object.fromEntries(SCENE_OBJECTS.map((item) => [item.id, item])) as Record<string, SceneObjectSpec>,
    [],
  );

  const [sensorState, setSensorState] = useState<SensorState>("searching");
  const [statusLabel, setStatusLabel] = useState("손을 찾는 중");
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [labels, setLabels] = useState<ObjectLabel[]>([]);
  const [plannerInfo, setPlannerInfo] = useState<PlannerInfo>({
    stage: "auto-scan",
    stageLabel: "자동 NBV 탐색 중",
    activeView: CANDIDATE_VIEWS[0].label,
    bestView: CANDIDATE_VIEWS[0].label,
    priorityTarget: null,
  });

  function currentCandidate(id: string) {
    return candidateLookupRef.current.get(id) ?? CANDIDATE_VIEWS[0];
  }

  function updateSpeedFromPointer(clientX: number) {
    const track = speedTrackRef.current;
    if (!track) {
      return;
    }

    const bounds = track.getBoundingClientRect();
    const ratio = clamp01((clientX - bounds.left) / Math.max(bounds.width, 1));
    const nextSpeed = clamp(SPEED_MIN + ratio * (SPEED_MAX - SPEED_MIN), SPEED_MIN, SPEED_MAX);
    speedRef.current = nextSpeed;
    setSimulationSpeed(nextSpeed);
  }

  function pickNextPoseTarget() {
    const manualTarget = manualPriorityIdRef.current
      ? objectEntriesRef.current.find(
          (entry) =>
            entry.spec.id === manualPriorityIdRef.current &&
            !entry.grasped &&
            !entry.poseSolved &&
            1 - entry.uncertainty > 0.56 &&
            entry.planProgress > 0.52,
        )
      : null;

    if (manualTarget) {
      return manualTarget;
    }

    return objectEntriesRef.current
      .filter(
        (entry) =>
          !entry.grasped &&
          !entry.poseSolved &&
          1 - entry.uncertainty > 0.56 &&
          entry.planProgress > 0.52,
      )
      .sort((left, right) => {
        const leftScore = (1 - left.uncertainty) * 0.54 + left.planProgress * 0.46;
        const rightScore = (1 - right.uncertainty) * 0.54 + right.planProgress * 0.46;
        return rightScore - leftScore;
      })[0];
  }

  function pickNextExecutionTarget() {
    const manualTarget = manualPriorityIdRef.current
      ? objectEntriesRef.current.find(
          (entry) => entry.spec.id === manualPriorityIdRef.current && entry.graspReady && !entry.grasped,
        )
      : null;

    if (manualTarget) {
      return manualTarget;
    }

    return objectEntriesRef.current
      .filter((entry) => entry.graspReady && !entry.grasped)
      .sort((left, right) => {
        if (right.graspScore !== left.graspScore) {
          return right.graspScore - left.graspScore;
        }

        return right.planProgress - left.planProgress;
      })[0];
  }

  function beginDisturbance(now: number, targetId: string) {
    const currentEffector = effectorGroupRef.current?.position.clone() ?? currentCameraPositionRef.current.clone();
    disturbanceTaskRef.current = {
      targetId,
      phase: "approach",
      phaseStartedAt: now,
      startEffector: currentEffector,
      approachPosition: new THREE.Vector3(-0.8, 1.2, 1.08),
      sweepStart: new THREE.Vector3(-1.2, 0.88, 1.02),
      sweepEnd: new THREE.Vector3(1.42, 0.86, -0.96),
      resetPosition: currentCameraPositionRef.current.clone(),
    };
  }

  function beginAutoTask(entry: RuntimeObject, now: number) {
    const dropIndex = dropCountRef.current;
    const dropPosition = new THREE.Vector3(
      3.1 - (dropIndex % 3) * 0.88,
      0.66,
      -2.1 + Math.floor(dropIndex / 3) * 0.68,
    );

    const currentEffector = effectorGroupRef.current?.position.clone() ?? currentCameraPositionRef.current.clone();
    const hoverPosition = entry.group.position.clone().add(new THREE.Vector3(0, 1.02, 0.48));
    const liftPosition = entry.group.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    const carryPosition = dropPosition.clone().add(new THREE.Vector3(0, 1.08, 0.16));

    autoTaskRef.current = {
      id: entry.spec.id,
      phase: "approach",
      phaseStartedAt: now,
      startEffector: currentEffector,
      hoverPosition,
      liftPosition,
      carryPosition,
      dropPosition,
      objectStart: entry.group.position.clone(),
    };
  }

  function intersectHoveredObject() {
    const camera = cameraRef.current;
    if (!camera || objectEntriesRef.current.length === 0) {
      return null;
    }

    raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
    const hits = raycasterRef.current.intersectObjects(
      objectEntriesRef.current.map((entry) => entry.group),
      true,
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
    scene.fog = new THREE.Fog("#03050a", 14, 28);

    const camera = new THREE.PerspectiveCamera(
      34,
      viewportRef.current.width / viewportRef.current.height,
      0.1,
      90,
    );
    camera.position.copy(currentCameraPositionRef.current);
    camera.lookAt(currentCameraTargetRef.current);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(viewportRef.current.width, viewportRef.current.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    rendererRef.current = renderer;
    cameraRef.current = camera;

    const ambient = new THREE.AmbientLight("#d2dcff", 0.8);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight("#f1f5ff", 1.4);
    keyLight.position.set(6.4, 8.8, 7.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 28;
    keyLight.shadow.camera.left = -7;
    keyLight.shadow.camera.right = 7;
    keyLight.shadow.camera.top = 7;
    keyLight.shadow.camera.bottom = -7;
    scene.add(keyLight);

    const fillLight = new THREE.PointLight("#64a7ff", 1.0, 28, 2);
    fillLight.position.set(-5.4, 4.2, 4.6);
    scene.add(fillLight);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(8.6, 80),
      new THREE.MeshStandardMaterial({
        color: "#060910",
        roughness: 0.92,
        metalness: 0.06,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(3.12, 3.36, 0.4, 48),
      new THREE.MeshStandardMaterial({
        color: "#111722",
        metalness: 0.24,
        roughness: 0.56,
      }),
    );
    platform.position.y = 0.18;
    platform.receiveShadow = true;
    platform.castShadow = true;
    scene.add(platform);

    const tableTop = new THREE.Mesh(
      new THREE.CylinderGeometry(2.94, 2.94, 0.12, 40),
      new THREE.MeshStandardMaterial({
        color: "#171d28",
        metalness: 0.22,
        roughness: 0.44,
      }),
    );
    tableTop.position.y = 0.42;
    tableTop.receiveShadow = true;
    tableTop.castShadow = true;
    scene.add(tableTop);

    const grid = new THREE.GridHelper(10, 16, "#243040", "#111722");
    grid.position.y = 0.01;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    scene.add(grid);

    const basketBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.88, 0.98, 0.22, 28),
      new THREE.MeshStandardMaterial({
        color: "#161d28",
        metalness: 0.34,
        roughness: 0.56,
      }),
    );
    basketBase.position.set(3.22, 0.18, -1.82);
    basketBase.castShadow = true;
    basketBase.receiveShadow = true;
    scene.add(basketBase);

    const basketWall = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.88, 0.88, 0.84, 16, 1, true)),
      new THREE.LineBasicMaterial({
        color: "#7ed0ff",
        transparent: true,
        opacity: 0.42,
      }),
    );
    basketWall.position.set(3.22, 0.62, -1.82);
    scene.add(basketWall);

    objectEntriesRef.current = SCENE_OBJECTS.map((spec) => createRuntimeObject(scene, spec));

    CANDIDATE_VIEWS.forEach((view) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 18, 18),
        new THREE.MeshBasicMaterial({
          color: "#9db7ff",
          transparent: true,
          opacity: 0.26,
        }),
      );
      marker.position.set(...view.position);
      scene.add(marker);
      candidateMarkersRef.current.set(view.id, marker);
    });

    const robotArmBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.42, 0.44, 24),
      new THREE.MeshStandardMaterial({
        color: "#232a33",
        metalness: 0.58,
        roughness: 0.34,
      }),
    );
    robotArmBase.position.set(-4.9, 0.22, 4.9);
    scene.add(robotArmBase);

    const armLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-4.9, 0.22, 4.9),
        new THREE.Vector3(-3.7, 2.4, 3.3),
        new THREE.Vector3(-2.2, 3.4, 1.9),
        currentCameraPositionRef.current.clone(),
      ]),
      new THREE.LineBasicMaterial({
        color: "#9ec0ff",
        transparent: true,
        opacity: 0.74,
      }),
    );
    scene.add(armLine);
    robotArmLineRef.current = armLine;

    const effectorGroup = new THREE.Group();
    scene.add(effectorGroup);
    effectorGroupRef.current = effectorGroup;

    const effectorBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.16, 0.34),
      new THREE.MeshStandardMaterial({
        color: "#dbe6fb",
        emissive: "#6e8fff",
        emissiveIntensity: 0.34,
        roughness: 0.24,
        metalness: 0.54,
      }),
    );
    effectorGroup.add(effectorBody);

    const leftFinger = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.34, 0.08),
      new THREE.MeshStandardMaterial({
        color: "#f4f7fb",
        roughness: 0.22,
        metalness: 0.38,
      }),
    );
    const rightFinger = leftFinger.clone();
    effectorGroup.add(leftFinger);
    effectorGroup.add(rightFinger);
    leftFingerRef.current = leftFinger;
    rightFingerRef.current = rightFinger;

    const sensorFrustum = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.ConeGeometry(0.72, 1.4, 4, 1, true)),
      new THREE.LineBasicMaterial({
        color: "#6ec2ff",
        transparent: true,
        opacity: 0.4,
      }),
    );
    scene.add(sensorFrustum);
    sensorFrustumRef.current = sensorFrustum;

    const tempRaycaster = new THREE.Raycaster();
    const tempPoint = new THREE.Vector3();
    const visibleSamples = new Map<string, number>();
    let lastFrame = performance.now();

    const render = (now: number) => {
      const delta = Math.min((now - lastFrame) / 1000, 0.05) * speedRef.current;
      lastFrame = now;

      const activeCandidate = currentCandidate(activeViewIdRef.current);
      const targetCandidate = currentCandidate(targetViewIdRef.current);
      const targetCameraPose = buildCameraPose(targetCandidate, userPanRef.current, viewOrbitRef.current);
      const cameraPositionAlpha = clamp(
        (autoTaskRef.current || grabbedIdRef.current ? 0.05 : 0.038) * speedRef.current,
        0.025,
        0.18,
      );
      const cameraTargetAlpha = clamp(0.08 * speedRef.current, 0.04, 0.22);
      currentCameraPositionRef.current.lerp(
        targetCameraPose.position,
        cameraPositionAlpha,
      );
      currentCameraTargetRef.current.lerp(targetCameraPose.target, cameraTargetAlpha);

      camera.position.copy(currentCameraPositionRef.current);
      camera.lookAt(currentCameraTargetRef.current);

      const objectGroups = objectEntriesRef.current.map((entry) => entry.group);
      const objectBestScores = new Map<string, { score: number; viewId: string }>();
      const viewScores = CANDIDATE_VIEWS.map((candidate) => {
          const candidatePosition = buildCameraPose(
            candidate,
            userPanRef.current,
            { yaw: 0, pitch: 0, zoom: 1 },
          ).position;
        let totalScore = 0;
        let visibleCount = 0;

        objectEntriesRef.current.forEach((entry) => {
          if (entry.grasped) {
            return;
          }

          const sampleOffsets = objectSampleOffsets(entry.spec);
          const visibleHits = sampleOffsets.reduce((sum, offset) => {
            tempPoint.copy(entry.group.position).add(offset);
            const direction = tempPoint.clone().sub(candidatePosition);
            const maxDistance = direction.length();
            tempRaycaster.set(candidatePosition, direction.normalize());
            const hit = tempRaycaster
              .intersectObjects(objectGroups, true)
              .find((item) => item.distance <= maxDistance + 0.02);
            return sum + (resolveObjectId(hit?.object ?? null) === entry.spec.id ? 1 : 0);
          }, 0);
          const visibility = visibleHits / sampleOffsets.length;
          const graspability = computeGraspability(entry.spec, candidate);
          const uncertaintyNeed = 0.58 * entry.uncertainty + 0.42 * (1 - entry.planProgress);
          const preferredBoost = entry.spec.priorityViews.includes(candidate.id) ? 1.16 : 1;
          const manualPriorityBoost = manualPriorityIdRef.current === entry.spec.id ? 1.85 : 1;
          const score = visibility * graspability * uncertaintyNeed * preferredBoost * manualPriorityBoost;

          if (visibility > 0.26) {
            visibleCount += 1;
          }

          totalScore += score;

          const bestForObject = objectBestScores.get(entry.spec.id);
          if (!bestForObject || bestForObject.score < score) {
            objectBestScores.set(entry.spec.id, {
              score,
              viewId: candidate.id,
            });
          }
        });

        return {
          candidate,
          score: totalScore,
          visibleCount,
        };
      }).sort((left, right) => right.score - left.score);

      objectEntriesRef.current.forEach((entry) => {
        entry.bestViewId = objectBestScores.get(entry.spec.id)?.viewId ?? entry.bestViewId;
      });

      const nextBest = viewScores[0] ?? {
        candidate: CANDIDATE_VIEWS[0],
        score: 0,
        visibleCount: 0,
      };
      bestViewIdRef.current = nextBest.candidate.id;

      if (currentCameraPositionRef.current.distanceTo(targetCameraPose.position) < 0.14) {
        activeViewIdRef.current = targetViewIdRef.current;
      }

      const activePosition = currentCameraPositionRef.current.clone();
      visibleSamples.clear();
      objectEntriesRef.current.forEach((entry) => {
        const sampleOffsets = objectSampleOffsets(entry.spec);
        const visibleHits = sampleOffsets.reduce((sum, offset) => {
          tempPoint.copy(entry.group.position).add(offset);
            const direction = tempPoint.clone().sub(activePosition);
            const maxDistance = direction.length();
            tempRaycaster.set(activePosition, direction.normalize());
            const hit = tempRaycaster
              .intersectObjects(objectGroups, true)
              .find((item) => item.distance <= maxDistance + 0.02);
          return sum + (resolveObjectId(hit?.object ?? null) === entry.spec.id ? 1 : 0);
        }, 0);

        visibleSamples.set(entry.spec.id, visibleHits / sampleOffsets.length);
      });

      const manualMoveId = grabbedIdRef.current;
      objectEntriesRef.current.forEach((entry) => {
        const visibility = visibleSamples.get(entry.spec.id) ?? 0;
        const preferredBoost = entry.spec.priorityViews.includes(activeViewIdRef.current) ? 1.14 : 1;
        const graspability = computeGraspability(entry.spec, activeCandidate);

        if (!entry.grasped && manualMoveId !== entry.spec.id) {
          entry.uncertainty = clamp(
            entry.uncertainty - visibility * delta * 0.17 * preferredBoost + (1 - visibility) * delta * 0.007,
            0.05,
            1,
          );
          entry.planProgress = clamp(
            entry.planProgress + visibility * delta * 0.22 * graspability * preferredBoost,
            0,
            1,
          );
          entry.graspScore = clamp(
            entry.graspScore + visibility * delta * 0.2 * graspability * preferredBoost - (1 - visibility) * delta * 0.008,
            0,
            1,
          );
        }

        const confidence = 1 - entry.uncertainty;
        if (entry.grasped) {
          entry.poseSolved = true;
        }
        entry.graspReady =
          !entry.grasped &&
          entry.poseSolved &&
          confidence > 0.64 &&
          entry.planProgress > 0.72 &&
          entry.graspScore > 0.56;

        const hovered = hoveredIdRef.current === entry.spec.id;
        const grabbed = grabbedIdRef.current === entry.spec.id || autoTaskRef.current?.id === entry.spec.id;
        const prioritized = manualPriorityIdRef.current === entry.spec.id;
        entry.material.emissive.set(grabbed ? "#ffd292" : prioritized ? "#79d8ff" : hovered ? "#88b8ff" : "#05070a");
        entry.material.emissiveIntensity = grabbed ? 0.68 : prioritized ? 0.46 : hovered ? 0.38 : 0.16;
        entry.group.scale.lerp(
          new THREE.Vector3(
            grabbed ? 1.08 : prioritized ? 1.04 : hovered ? 1.03 : 1,
            grabbed ? 1.08 : prioritized ? 1.04 : hovered ? 1.03 : 1,
            grabbed ? 1.08 : prioritized ? 1.04 : hovered ? 1.03 : 1,
          ),
          0.14,
        );
        (entry.halo.material as THREE.MeshBasicMaterial).opacity = entry.grasped
          ? 0.04
          : grabbed
            ? 0.28
            : prioritized
              ? 0.18
              : 0.08 + entry.uncertainty * 0.04;
      });

      const poseTarget = pickNextPoseTarget();
      const allGrasped = objectEntriesRef.current.every((entry) => entry.grasped);
      const readyCount = objectEntriesRef.current.filter((entry) => !entry.grasped && entry.graspReady).length;
      const disturbanceTask = disturbanceTaskRef.current;
      const nextStage: PlannerStage = allGrasped
        ? "complete"
        : disturbanceTask
          ? "pile-disturbance"
          : autoTaskRef.current || readyCount > 0
            ? "auto-grasp"
            : poseTarget
              ? "pose-estimation"
              : "auto-scan";
      plannerStageRef.current = nextStage;

      if (!disturbanceTask && !autoTaskRef.current && !grabbedIdRef.current) {
        if (poseTarget && !poseTarget.poseSolved) {
          targetViewIdRef.current = poseTarget.bestViewId;
        } else if (nextStage !== "auto-grasp") {
          targetViewIdRef.current = nextBest.candidate.id;
        }
      }

      if (disturbanceTask && effectorGroupRef.current) {
        const targetEntry = objectEntriesRef.current.find((entry) => entry.spec.id === disturbanceTask.targetId);
        const scaledElapsed = (now - disturbanceTask.phaseStartedAt) * speedRef.current;

        if (disturbanceTask.phase === "approach") {
          const t = clamp01(scaledElapsed / 620);
          effectorGroupRef.current.position.lerpVectors(
            disturbanceTask.startEffector,
            disturbanceTask.approachPosition,
            t,
          );
          gripperOpenRef.current = lerp(gripperOpenRef.current, 0.68, 0.16);
          if (t >= 1) {
            disturbanceTaskRef.current = {
              ...disturbanceTask,
              phase: "sweep",
              phaseStartedAt: now,
              startEffector: disturbanceTask.approachPosition.clone(),
            };
          }
        } else if (disturbanceTask.phase === "sweep") {
          const t = clamp01(scaledElapsed / 940);
          effectorGroupRef.current.position.lerpVectors(
            disturbanceTask.sweepStart,
            disturbanceTask.sweepEnd,
            t,
          );
          gripperOpenRef.current = lerp(gripperOpenRef.current, 0.82, 0.18);

          objectEntriesRef.current.forEach((entry) => {
            if (entry.grasped) {
              return;
            }

            const away = entry.group.position.clone().sub(effectorGroupRef.current!.position);
            away.y = 0;
            const distanceToSweep = away.length();
            if (distanceToSweep < 1.26) {
              const push = away.lengthSq() > 0.0001 ? away.normalize() : new THREE.Vector3(1, 0, 0);
              entry.group.position.x = clamp(entry.group.position.x + push.x * delta * 0.9, -2.2, 2.2);
              entry.group.position.z = clamp(entry.group.position.z + push.z * delta * 0.9, -2.2, 2.2);
              entry.uncertainty = clamp(entry.uncertainty - 0.03, 0.05, 1);
              entry.planProgress = clamp(entry.planProgress + 0.04, 0, 1);
              entry.graspScore = clamp(entry.graspScore + 0.02, 0, 1);
            }
          });

          if (t >= 1) {
            disturbanceTaskRef.current = {
              ...disturbanceTask,
              phase: "reset",
              phaseStartedAt: now,
              startEffector: disturbanceTask.sweepEnd.clone(),
            };
          }
        } else {
          const t = clamp01(scaledElapsed / 560);
          effectorGroupRef.current.position.lerpVectors(
            disturbanceTask.sweepEnd,
            disturbanceTask.resetPosition,
            t,
          );
          gripperOpenRef.current = lerp(gripperOpenRef.current, 0.52, 0.14);
          if (t >= 1) {
            if (targetEntry) {
              targetEntry.poseAttempts = 0;
              targetEntry.poseSolved = false;
              targetEntry.uncertainty = clamp(targetEntry.uncertainty - 0.06, 0.05, 1);
              targetEntry.planProgress = clamp(targetEntry.planProgress + 0.08, 0, 1);
            }
            poseAttemptRef.current = {
              targetId: disturbanceTask.targetId,
              lastAttemptAt: now,
            };
            disturbanceTaskRef.current = null;
          }
        }
      } else if (poseTarget && !poseTarget.poseSolved && !autoTaskRef.current && !grabbedIdRef.current) {
        const poseState = poseAttemptRef.current;
        if (poseState.targetId !== poseTarget.spec.id) {
          poseAttemptRef.current = {
            targetId: poseTarget.spec.id,
            lastAttemptAt: 0,
          };
        }

        const desiredPose = buildCameraPose(
          currentCandidate(poseTarget.bestViewId),
          userPanRef.current,
          viewOrbitRef.current,
        ).position;
        const poseQuality =
          (visibleSamples.get(poseTarget.spec.id) ?? 0) *
          computeGraspability(poseTarget.spec, activeCandidate) *
          ((1 - poseTarget.uncertainty) * 0.62 + poseTarget.planProgress * 0.38);

        if (
          currentCameraPositionRef.current.distanceTo(desiredPose) < 0.24 &&
          now - poseAttemptRef.current.lastAttemptAt >= POSE_ATTEMPT_INTERVAL_MS / speedRef.current
        ) {
          poseAttemptRef.current.lastAttemptAt = now;
          poseTarget.poseAttempts += 1;

          if (poseQuality > 0.34 || (poseQuality > 0.28 && poseTarget.poseAttempts >= 3)) {
            poseTarget.poseSolved = true;
            poseTarget.graspScore = clamp(Math.max(poseTarget.graspScore, 0.76), 0, 1);
            poseTarget.planProgress = clamp(poseTarget.planProgress + 0.08, 0, 1);
          } else if (poseTarget.poseAttempts > 5) {
            beginDisturbance(now, poseTarget.spec.id);
          } else {
            poseTarget.uncertainty = clamp(poseTarget.uncertainty - 0.025, 0.05, 1);
            poseTarget.planProgress = clamp(poseTarget.planProgress + 0.05, 0, 1);
          }
        }
      } else if (nextStage === "auto-grasp" && !grabbedIdRef.current && !disturbanceTaskRef.current) {
        const activeTask = autoTaskRef.current;
        if (!activeTask) {
          const nextTarget = pickNextExecutionTarget();
          if (nextTarget) {
            targetViewIdRef.current = nextTarget.bestViewId;
            const desiredExecutionView = currentCandidate(nextTarget.bestViewId);
            const desiredExecutionPosition = buildCameraPose(
              desiredExecutionView,
              userPanRef.current,
              viewOrbitRef.current,
            ).position;
            if (currentCameraPositionRef.current.distanceTo(desiredExecutionPosition) < 0.3) {
              beginAutoTask(nextTarget, now);
            }
          }
        } else {
          const entry = objectEntriesRef.current.find((item) => item.spec.id === activeTask.id);
          if (entry) {
            const elapsed = (now - activeTask.phaseStartedAt) * speedRef.current;
            const effector = effectorGroupRef.current;
            if (effector) {
              if (activeTask.phase === "approach") {
                const t = clamp01(elapsed / 780);
                effector.position.lerpVectors(activeTask.startEffector, activeTask.hoverPosition, t);
                gripperOpenRef.current = lerp(gripperOpenRef.current, Math.min(entry.spec.graspWidth + 0.18, 0.7), 0.14);
                if (t >= 1) {
                  autoTaskRef.current = {
                    ...activeTask,
                    phase: "lift",
                    phaseStartedAt: now,
                    startEffector: activeTask.hoverPosition.clone(),
                    objectStart: entry.group.position.clone(),
                  };
                }
              } else if (activeTask.phase === "lift") {
                const t = clamp01(elapsed / 880);
                effector.position.lerpVectors(activeTask.hoverPosition, activeTask.liftPosition, t);
                entry.group.position.lerpVectors(
                  activeTask.objectStart,
                  activeTask.liftPosition.clone().add(new THREE.Vector3(0, -0.28, 0)),
                  t,
                );
                gripperOpenRef.current = lerp(gripperOpenRef.current, Math.min(entry.spec.graspWidth + 0.04, 0.28), 0.22);
                if (t >= 1) {
                  autoTaskRef.current = {
                    ...activeTask,
                    phase: "carry",
                    phaseStartedAt: now,
                    startEffector: activeTask.liftPosition.clone(),
                    objectStart: entry.group.position.clone(),
                  };
                }
              } else if (activeTask.phase === "carry") {
                const t = clamp01(elapsed / 1360);
                effector.position.lerpVectors(activeTask.liftPosition, activeTask.carryPosition, t);
                entry.group.position.lerpVectors(
                  activeTask.objectStart,
                  activeTask.carryPosition.clone().add(new THREE.Vector3(0, -0.28, 0)),
                  t,
                );
                gripperOpenRef.current = lerp(gripperOpenRef.current, Math.min(entry.spec.graspWidth + 0.04, 0.24), 0.18);
                if (t >= 1) {
                  autoTaskRef.current = {
                    ...activeTask,
                    phase: "drop",
                    phaseStartedAt: now,
                    startEffector: activeTask.carryPosition.clone(),
                    objectStart: entry.group.position.clone(),
                  };
                }
              } else {
                const t = clamp01(elapsed / 920);
                const dropHover = activeTask.dropPosition.clone().add(new THREE.Vector3(0, 0.74, 0.16));
                effector.position.lerpVectors(activeTask.carryPosition, dropHover, t);
                entry.group.position.lerpVectors(activeTask.objectStart, activeTask.dropPosition, t);
                gripperOpenRef.current = lerp(gripperOpenRef.current, Math.min(entry.spec.graspWidth + 0.2, 0.6), 0.16);
                if (t >= 1) {
                  entry.group.position.copy(activeTask.dropPosition);
                  entry.grasped = true;
                  entry.poseSolved = true;
                  entry.dropSlot = dropCountRef.current;
                  entry.uncertainty = 0.05;
                  entry.planProgress = 1;
                  entry.graspScore = 1;
                  dropCountRef.current += 1;
                  if (manualPriorityIdRef.current === entry.spec.id) {
                    manualPriorityIdRef.current = null;
                  }
                  autoTaskRef.current = null;
                }
              }
            }
          }
        }
      } else if (!autoTaskRef.current && effectorGroupRef.current) {
        effectorGroupRef.current.position.copy(currentCameraPositionRef.current);
        gripperOpenRef.current = lerp(gripperOpenRef.current, 0.52, 0.08);
      }

      if (!autoTaskRef.current && effectorGroupRef.current) {
        effectorGroupRef.current.position.copy(currentCameraPositionRef.current);
      }

      const effectorGroup = effectorGroupRef.current;
      if (effectorGroup && leftFingerRef.current && rightFingerRef.current) {
        leftFingerRef.current.position.set(-gripperOpenRef.current * 0.5, -0.18, 0.12);
        rightFingerRef.current.position.set(gripperOpenRef.current * 0.5, -0.18, 0.12);
        effectorGroup.lookAt(currentCameraTargetRef.current);
      }

      if (sensorFrustumRef.current && effectorGroupRef.current) {
        sensorFrustumRef.current.visible = !autoTaskRef.current || autoTaskRef.current.phase === "approach";
        sensorFrustumRef.current.position.copy(effectorGroupRef.current.position);
        sensorFrustumRef.current.rotation.set(0, 0, 0);
        sensorFrustumRef.current.lookAt(currentCameraTargetRef.current);
        sensorFrustumRef.current.rotateX(Math.PI / 2);
      }

      if (robotArmLineRef.current && effectorGroupRef.current) {
        robotArmLineRef.current.geometry.setFromPoints([
          new THREE.Vector3(-4.9, 0.22, 4.9),
          new THREE.Vector3(-3.7, 2.4, 3.3),
          new THREE.Vector3(-2.2, 3.45, 1.95),
          effectorGroupRef.current.position.clone(),
        ]);
      }

      candidateMarkersRef.current.forEach((marker, id) => {
        const candidate = currentCandidate(id);
        marker.position.copy(buildCameraPose(candidate, userPanRef.current, { yaw: 0, pitch: 0, zoom: 1 }).position);
        const material = marker.material as THREE.MeshBasicMaterial;
        const isBest = id === bestViewIdRef.current;
        const isActive = id === activeViewIdRef.current;
        material.color.set(isBest ? "#f7c66a" : isActive ? "#7ed0ff" : "#9db7ff");
        material.opacity = isBest ? 0.92 : isActive ? 0.62 : 0.2;
        marker.scale.lerp(
          new THREE.Vector3(isBest ? 1.4 : isActive ? 1.22 : 1, isBest ? 1.4 : isActive ? 1.22 : 1, isBest ? 1.4 : isActive ? 1.22 : 1),
          0.14,
        );
      });

      const hoveredHit = grabbedIdRef.current ? null : intersectHoveredObject();
      hoveredIdRef.current = resolveObjectId(hoveredHit?.object ?? null);

      if (now - labelsPublishAtRef.current >= LABEL_PUBLISH_MS) {
        labelsPublishAtRef.current = now;
        const width = viewportRef.current.width;
        const height = viewportRef.current.height;
        setLabels(
          objectEntriesRef.current.map((entry) => {
            const labelPoint = worldToScreen(
              entry.group.position.clone().add(new THREE.Vector3(0, Math.max(entry.spec.size[1] * 1.25, 0.72), 0)),
              camera,
              width,
              height,
            );

            return {
              id: entry.spec.id,
              name: entry.spec.name,
              semanticClass: entry.spec.semanticClass,
              confidence: clampConfidence(1 - entry.uncertainty),
              x: labelPoint.x,
              y: labelPoint.y,
              visible: labelPoint.visible && ((visibleSamples.get(entry.spec.id) ?? 0) > 0.08 || entry.grasped),
              priority: manualPriorityIdRef.current === entry.spec.id,
              hovered: hoveredIdRef.current === entry.spec.id,
              grasped: entry.grasped,
              ready: entry.graspReady,
            };
          }),
        );

        setPlannerInfo({
          stage: nextStage,
          stageLabel:
            nextStage === "complete"
              ? "모든 grasp 완료"
              : nextStage === "pile-disturbance"
                ? "pile disturbance 수행 중"
                : nextStage === "pose-estimation"
                  ? "pose estimation 반복 중"
              : nextStage === "auto-grasp"
                ? "자동 grasp 수행 중"
                : grabbedIdRef.current
                  ? "오른손 pinch grasp 재계획 중"
                  : manualPriorityIdRef.current
                    ? "우선 물체 정밀 스캔 중"
                    : "자동 NBV 탐색 중",
          activeView: currentCandidate(activeViewIdRef.current).label,
          bestView: nextBest.candidate.label,
          priorityTarget: manualPriorityIdRef.current
            ? objectLookup[manualPriorityIdRef.current]?.name ?? null
            : null,
        });
      }

      renderer.render(scene, camera);
      renderFrameRef.current = window.requestAnimationFrame(render);
    };

    renderFrameRef.current = window.requestAnimationFrame(render);

    return () => {
      if (renderFrameRef.current) {
        cancelAnimationFrame(renderFrameRef.current);
      }

      objectEntriesRef.current.forEach((entry) => {
        disposeThreeObject(entry.group);
        scene.remove(entry.group);
      });
      candidateMarkersRef.current.forEach((marker) => {
        disposeThreeObject(marker);
        scene.remove(marker);
      });
      if (robotArmLineRef.current) {
        disposeThreeObject(robotArmLineRef.current);
      }
      if (effectorGroupRef.current) {
        disposeThreeObject(effectorGroupRef.current);
        scene.remove(effectorGroupRef.current);
      }
      if (sensorFrustumRef.current) {
        disposeThreeObject(sensorFrustumRef.current);
        scene.remove(sensorFrustumRef.current);
      }
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [objectLookup]);

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
          setStatusLabel("카메라 접근이 차단됨");
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
        const leftClustered = actionHand ? isHandClustered(actionHand) : false;

        drawPreview(
          previewCanvasRef.current,
          videoRef.current,
          hands,
          pointerHand,
          actionHand,
          rightPinched,
          leftPinched,
          leftDragRef.current.active,
        );

        if (!pointerHand) {
          pointerVisibleRef.current = false;
          grabbedIdRef.current = null;
          rightPinchedRef.current = false;
          leftPinchedRef.current = false;
          leftDragRef.current.active = false;
          rightPanRef.current.active = false;
          pinchZoomRef.current.active = false;
          speedDragRef.current = false;
          exitArmedAtRef.current = null;
          hoveredIdRef.current = null;
          setHoveredAction(null);
          setSensorState(brightnessRef.current < LOW_LIGHT_THRESHOLD ? "low-light" : "searching");
          setStatusLabel(
            brightnessRef.current < LOW_LIGHT_THRESHOLD ? "조명이 너무 어두움" : "손을 찾는 중",
          );
          trackingFrameRef.current = requestAnimationFrame(loop);
          return;
        }

        pointerVisibleRef.current = true;
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
        const hoveredAction =
          document
            .elementFromPoint(pointerRef.current.x, pointerRef.current.y)
            ?.closest("[data-action-id]")
            ?.getAttribute("data-action-id") ?? null;
        setHoveredAction(hoveredAction);
        const speedHover = hoveredAction === SPEED_CONTROL_ID;
        leftDragRef.current.active = false;
        rightPanRef.current.active = false;
        pinchZoomRef.current.active = false;

        if (rightPinched && (speedHover || speedDragRef.current)) {
          speedDragRef.current = true;
          updateSpeedFromPointer(pointerRef.current.x);
        } else if (!rightPinched) {
          speedDragRef.current = false;
        }

        if (leftPinched && !leftPinchedRef.current && hoveredIdRef.current && !rightPinched) {
          manualPriorityIdRef.current = hoveredIdRef.current;
          const entry = objectEntriesRef.current.find((item) => item.spec.id === hoveredIdRef.current);
          if (entry) {
            targetViewIdRef.current = entry.bestViewId;
            entry.uncertainty = clamp(entry.uncertainty - 0.08, 0.05, 1);
            entry.planProgress = clamp(entry.planProgress + 0.12, 0, 1);
            entry.graspScore = clamp(entry.graspScore + 0.08, 0, 1);
            entry.poseAttempts = 0;
          }
        }
        leftPinchedRef.current = leftPinched;

        if (rightPinched && !rightPinchedRef.current && !speedDragRef.current) {
          const hit = intersectHoveredObject();
          const grabbedId = resolveObjectId(hit?.object ?? null) ?? hoveredIdRef.current;
          if (grabbedId) {
            const entry = objectEntriesRef.current.find((item) => item.spec.id === grabbedId);
            if (entry) {
              grabbedIdRef.current = grabbedId;
              grabPlaneRef.current.set(new THREE.Vector3(0, 1, 0), -entry.group.position.y);
              grabOffsetRef.current.copy(entry.group.position).sub(hit?.point ?? entry.group.position);
              autoTaskRef.current = null;
              disturbanceTaskRef.current = null;
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
              entry.group.position.x = clamp(next.x, -2.2, 2.2);
              entry.group.position.z = clamp(next.z, -2.2, 2.2);
              entry.uncertainty = clamp(entry.uncertainty + 0.015, 0.05, 1);
              entry.planProgress = clamp(entry.planProgress - 0.02, 0.1, 1);
              entry.graspScore = clamp(entry.graspScore - 0.01, 0.1, 1);
            }
          }
        }

        if (hoveredAction === EXIT_BUTTON_ID && leftClustered) {
          if (!exitArmedAtRef.current) {
            exitArmedAtRef.current = now;
          } else if (now - exitArmedAtRef.current >= EXIT_HOLD_MS) {
            router.push("/");
            return;
          }
        } else {
          exitArmedAtRef.current = null;
        }

        setSensorState(brightnessRef.current < LOW_LIGHT_THRESHOLD ? "low-light" : "tracking");
        setStatusLabel(
          brightnessRef.current < LOW_LIGHT_THRESHOLD
            ? "조명이 너무 어두움"
            : grabbedIdRef.current
              ? "오른손 pinch grasp로 물체 이동 중"
              : speedDragRef.current
                ? `시뮬레이션 속도 ${speedRef.current.toFixed(2)}x`
                : manualPriorityIdRef.current
                  ? "왼손 pinch 정밀 스캔 명령 유지 중"
                  : disturbanceTaskRef.current
                    ? "pile disturbance로 pose estimation 재시도 중"
                    : "자동 NBV + grasp planning 유지 중",
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
  }, [objectLookup, router]);

  return (
    <main className={styles.shell}>
      <div ref={mountRef} className={styles.viewport} />
      <div className={styles.vignette} />

      <header className={styles.topBar}>
        <div className={styles.speedDock}>
          <span className={styles.speedLabel}>Speed {simulationSpeed.toFixed(2)}x</span>
          <div
            ref={speedTrackRef}
            className={styles.speedTrack}
            data-action-id={SPEED_CONTROL_ID}
          >
            <div
              className={styles.speedFill}
              style={{
                width: `${((simulationSpeed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100}%`,
              }}
            />
            <span
              className={styles.speedThumb}
              data-action-id={SPEED_CONTROL_ID}
              style={{
                left: `${((simulationSpeed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100}%`,
              }}
            />
          </div>
        </div>
        <div className={styles.badgeRow}>
          <span className={styles.infoPill}>{plannerInfo.stageLabel}</span>
          <span className={styles.infoPill}>
            {plannerInfo.activeView} → {plannerInfo.bestView}
          </span>
          {plannerInfo.priorityTarget ? (
            <span className={styles.infoPillAccent}>우선 {plannerInfo.priorityTarget}</span>
          ) : null}
        </div>
      </header>

      <div className={styles.labelLayer} aria-hidden="true">
        {labels.map((label) =>
          label.visible ? (
            <div
              key={label.id}
              className={`${styles.objectLabel} ${
                label.priority ? styles.objectLabelPriority : ""
              } ${label.hovered ? styles.objectLabelHover : ""} ${
                label.ready ? styles.objectLabelReady : ""
              } ${label.grasped ? styles.objectLabelDone : ""}`}
              style={{ left: label.x, top: label.y }}
            >
              <strong className={styles.objectLabelTitle}>
                {label.semanticClass} {label.confidence}%
              </strong>
              <span className={styles.objectLabelName}>{label.name}</span>
            </div>
          ) : null,
        )}
      </div>

      <div
        className={styles.reticle}
        style={{ transform: `translate3d(${pointer.x}px, ${pointer.y}px, 0)` }}
      >
        <div className={styles.reticleCore} />
      </div>

      <button
        type="button"
        data-action-id={EXIT_BUTTON_ID}
        className={`${styles.exitButton} ${
          hoveredAction === EXIT_BUTTON_ID ? styles.exitButtonActive : ""
        }`}
      >
        Exit
      </button>

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
