"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./SolarSystemExperience.module.css";
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
type MoonSpec = {
  name: string;
  orbitRadius: number;
  orbitPeriod: number;
  radius: number;
  tint: string;
  note: string;
};
type BodySpec = {
  id: string;
  name: string;
  accent: string;
  description: string;
  effectLabel: string;
  atmosphereLabel: string;
  surfaceFocus: string;
  traits: string[];
  radius: number;
  orbitRadius: number;
  orbitPeriod: number;
  orbitTilt: number;
  colorA: string;
  colorB: string;
  moons: MoonSpec[];
};
type BodyScreen = {
  x: number;
  y: number;
  radius: number;
  body: BodySpec;
};
type SolarSystemExperienceProps = {
  blackHoleScene: ReactNode;
};

const CURSOR_GAIN_X = 1.74;
const CURSOR_GAIN_Y = 1.58;
const POINTER_SMOOTHING = 0.32;
const MENU_ENTRY_COOLDOWN_MS = 520;
const LOW_LIGHT_THRESHOLD = 42;
const PINCH_THRESHOLD = 0.48;
const SYSTEM_ZOOM = 1.18;
const FOCUS_EXIT_ZOOM = 1.42;
const FOCUS_ZOOM_STEP = 4.2;
const SUN_FOCUS_ZOOM = 3.6;
const MENU_RETURN_HOLD_MS = 220;
const BLACK_HOLE_HOLD_MS = 180;
const SOLAR_BODIES: BodySpec[] = [
  {
    id: "sun",
    name: "Sun",
    accent: "Star Core",
    description:
      "The solar furnace that anchors every orbit. The view emphasizes convective plasma lanes and eruptive flares rolling across the surface.",
    effectLabel: "Plasma bloom",
    atmosphereLabel: "Solar prominences",
    surfaceFocus: "Eruptive convection lanes and magnetic flare loops",
    traits: ["Nuclear fusion core", "Plasma granulation", "Magnetic storm arcs"],
    radius: 44,
    orbitRadius: 0,
    orbitPeriod: 1,
    orbitTilt: 0,
    colorA: "#ffdb8a",
    colorB: "#ff7d1f",
    moons: [],
  },
  {
    id: "mercury",
    name: "Mercury",
    accent: "Inner Edge",
    description:
      "Mercury stays scarred and heat-blasted, with cratered stone broken by a trembling thermal shimmer near the surface.",
    effectLabel: "Heat shimmer",
    atmosphereLabel: "Exosphere trace",
    surfaceFocus: "Crater fields with fractured basalt ridges",
    traits: ["Extreme day-night swing", "Impact-scarred crust", "Thin exosphere"],
    radius: 8,
    orbitRadius: 74,
    orbitPeriod: 12,
    orbitTilt: 0.36,
    colorA: "#cbb18d",
    colorB: "#77624a",
    moons: [],
  },
  {
    id: "venus",
    name: "Venus",
    accent: "Cloud Veil",
    description:
      "Venus is rendered as a dense sulfuric globe where high cloud layers drift in thick amber spirals.",
    effectLabel: "Sulfur haze",
    atmosphereLabel: "Opaque super-rotation",
    surfaceFocus: "Sulfur cloud decks with pressure-driven shear",
    traits: ["Runaway greenhouse heat", "Dense acid clouds", "Slow retrograde spin"],
    radius: 12,
    orbitRadius: 108,
    orbitPeriod: 20,
    orbitTilt: 0.34,
    colorA: "#f0ca8d",
    colorB: "#8f5f2d",
    moons: [],
  },
  {
    id: "earth",
    name: "Earth",
    accent: "Blue Weather",
    description:
      "Earth carries animated cloud belts and bright ocean bloom, with the Moon orbiting as the primary satellite anchor.",
    effectLabel: "Cloud drift",
    atmosphereLabel: "Weather bands",
    surfaceFocus: "Ocean blues, cloud rivers, and living weather fronts",
    traits: ["Liquid water surface", "Dynamic cloud systems", "Single large stabilizing moon"],
    radius: 14,
    orbitRadius: 146,
    orbitPeriod: 30,
    orbitTilt: 0.33,
    colorA: "#4e8dff",
    colorB: "#1b4a8a",
    moons: [
      { name: "Moon", orbitRadius: 18, orbitPeriod: 4, radius: 3.2, tint: "#d5d2cb", note: "Tidal anchor" },
    ],
  },
  {
    id: "mars",
    name: "Mars",
    accent: "Dust Front",
    description:
      "Mars shows ochre deserts and thin storm plumes, with Phobos and Deimos circling as close irregular moons.",
    effectLabel: "Dust storm",
    atmosphereLabel: "Thin carbon haze",
    surfaceFocus: "Ochre basins with sweeping dust front bands",
    traits: ["Iron-rich regolith", "Seasonal dust storms", "Two captured moons"],
    radius: 11,
    orbitRadius: 192,
    orbitPeriod: 44,
    orbitTilt: 0.31,
    colorA: "#ef9865",
    colorB: "#8d3f28",
    moons: [
      { name: "Phobos", orbitRadius: 16, orbitPeriod: 2.4, radius: 2.2, tint: "#b59a88", note: "Fast inner moon" },
      { name: "Deimos", orbitRadius: 23, orbitPeriod: 3.6, radius: 1.8, tint: "#cab39b", note: "Outer fragment" },
    ],
  },
  {
    id: "jupiter",
    name: "Jupiter",
    accent: "Band Giant",
    description:
      "Jupiter rotates through stacked cloud bands and a storm-heavy equator, with the Galilean moons distributed in wide luminous arcs.",
    effectLabel: "Storm bands",
    atmosphereLabel: "Ammonia cloud belts",
    surfaceFocus: "Layered cloud belts and giant turbulent vortices",
    traits: ["Great Red Spot scale storms", "Hydrogen-helium envelope", "Galilean moon system"],
    radius: 28,
    orbitRadius: 264,
    orbitPeriod: 68,
    orbitTilt: 0.28,
    colorA: "#f3d9b2",
    colorB: "#8a5b38",
    moons: [
      { name: "Io", orbitRadius: 32, orbitPeriod: 3.2, radius: 3, tint: "#ffd87e", note: "Volcanic sulfur" },
      { name: "Europa", orbitRadius: 40, orbitPeriod: 4.4, radius: 3.2, tint: "#d7e6ff", note: "Ice ocean shell" },
      { name: "Ganymede", orbitRadius: 49, orbitPeriod: 6.2, radius: 3.8, tint: "#b8aa96", note: "Largest moon" },
      { name: "Callisto", orbitRadius: 58, orbitPeriod: 8.4, radius: 3.4, tint: "#9f8c7e", note: "Cratered outer moon" },
    ],
  },
  {
    id: "saturn",
    name: "Saturn",
    accent: "Ring Archive",
    description:
      "Saturn glows with dusty rings and pale atmospheric bands, while Titan and icy companions trace the ring plane.",
    effectLabel: "Ring dust",
    atmosphereLabel: "Upper haze",
    surfaceFocus: "Fine ring debris and pale equatorial haze sheets",
    traits: ["Dominant ring system", "Low-density gas giant", "Titan methane atmosphere"],
    radius: 24,
    orbitRadius: 326,
    orbitPeriod: 92,
    orbitTilt: 0.26,
    colorA: "#f4d8a4",
    colorB: "#8a7144",
    moons: [
      { name: "Titan", orbitRadius: 34, orbitPeriod: 4.4, radius: 4, tint: "#efb55c", note: "Methane atmosphere" },
      { name: "Rhea", orbitRadius: 44, orbitPeriod: 6.1, radius: 2.8, tint: "#d5d4cf", note: "Ice crust" },
      { name: "Enceladus", orbitRadius: 52, orbitPeriod: 7.2, radius: 2.5, tint: "#f2f4ff", note: "Cryovolcanic plumes" },
    ],
  },
  {
    id: "uranus",
    name: "Uranus",
    accent: "Tilted Ice",
    description:
      "Uranus is presented as a cold cyan sphere with quiet auroral sheens, circled by Titania and Oberon.",
    effectLabel: "Aurora veil",
    atmosphereLabel: "Methane ice haze",
    surfaceFocus: "Muted cyan shell with cold polar glow",
    traits: ["Extreme axial tilt", "Ice giant interior", "Subtle auroral veil"],
    radius: 18,
    orbitRadius: 388,
    orbitPeriod: 122,
    orbitTilt: 0.24,
    colorA: "#a4f1f3",
    colorB: "#4d9bb3",
    moons: [
      { name: "Titania", orbitRadius: 28, orbitPeriod: 4.2, radius: 2.8, tint: "#d1d6df", note: "Major inner moon" },
      { name: "Oberon", orbitRadius: 36, orbitPeriod: 5.4, radius: 2.6, tint: "#b9c0cb", note: "Outer icy moon" },
    ],
  },
  {
    id: "neptune",
    name: "Neptune",
    accent: "Wind Deep",
    description:
      "Neptune keeps the darkest blues in the system, with wind streaks and a tight Triton orbit cutting across the outer dark.",
    effectLabel: "Jet stream",
    atmosphereLabel: "Supersonic methane winds",
    surfaceFocus: "Deep blue atmosphere with high-velocity wind scars",
    traits: ["Supersonic winds", "Methane-rich atmosphere", "Triton retrograde orbit"],
    radius: 18,
    orbitRadius: 442,
    orbitPeriod: 152,
    orbitTilt: 0.22,
    colorA: "#4d92ff",
    colorB: "#183e8a",
    moons: [
      { name: "Triton", orbitRadius: 30, orbitPeriod: 4.6, radius: 3, tint: "#d7dce7", note: "Retrograde moon" },
    ],
  },
];
const BODY_LOOKUP = Object.fromEntries(SOLAR_BODIES.map((body) => [body.id, body])) as Record<
  string,
  BodySpec
>;
const FINGERTIP_COLORS = ["#f7c66a", "#8af4dd", "#f4f7fb", "#f39bd8", "#78b9ff"];

function seededStars(count: number) {
  let seed = 1481;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  return Array.from({ length: count }, () => ({
    x: next(),
    y: next(),
    size: next() * 2.4 + 0.4,
    alpha: next() * 0.6 + 0.18,
  }));
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
      context.lineWidth = handIndex === 0 ? 2.4 : 1.4;
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

  if (actionHand) {
    context.beginPath();
    context.moveTo(actionHand[4].x * canvas.width, actionHand[4].y * canvas.height);
    context.lineTo(actionHand[8].x * canvas.width, actionHand[8].y * canvas.height);
    context.lineWidth = 4;
    context.strokeStyle = leftPinched
      ? "rgba(255, 186, 122, 0.94)"
      : "rgba(255, 255, 255, 0.36)";
    context.stroke();
  }
}

function lerp(start: number, end: number, alpha: number) {
  return start + (end - start) * alpha;
}

function orbitPosition(body: BodySpec, time: number) {
  if (body.orbitRadius === 0) {
    return { x: 0, y: 0 };
  }

  const theta = time / body.orbitPeriod + body.orbitRadius * 0.013;
  return {
    x: Math.cos(theta) * body.orbitRadius,
    y: Math.sin(theta) * body.orbitRadius * body.orbitTilt,
  };
}

function drawPlanetEffect(
  context: CanvasRenderingContext2D,
  body: BodySpec,
  x: number,
  y: number,
  radius: number,
  time: number,
  highlight: boolean,
) {
  const gradient = context.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.16, x, y, radius);
  gradient.addColorStop(0, body.colorA);
  gradient.addColorStop(1, body.colorB);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();

  if (body.id === "sun") {
    for (let index = 0; index < 10; index += 1) {
      const angle = time * 0.65 + index * 0.63;
      context.beginPath();
      context.strokeStyle = `rgba(255, ${120 + index * 8}, 48, ${highlight ? 0.45 : 0.22})`;
      context.lineWidth = 1.6 + (index % 3);
      context.arc(x, y, radius * (0.9 + index * 0.05), angle, angle + 0.7);
      context.stroke();
    }
    return;
  }

  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.clip();

  if (body.id === "earth") {
    context.fillStyle = "rgba(92, 194, 121, 0.42)";
    context.beginPath();
    context.ellipse(x - radius * 0.12, y + radius * 0.04, radius * 0.28, radius * 0.18, 0.3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = `rgba(255, 255, 255, ${highlight ? 0.5 : 0.34})`;
    for (let index = 0; index < 5; index += 1) {
      context.beginPath();
      context.ellipse(
        x + Math.cos(time * 0.6 + index) * radius * 0.2,
        y + Math.sin(time * 0.4 + index * 1.2) * radius * 0.18,
        radius * (0.28 + index * 0.02),
        radius * 0.08,
        index * 0.4,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  } else if (body.id === "jupiter" || body.id === "saturn") {
    for (let index = -3; index <= 3; index += 1) {
      context.fillStyle = `rgba(255, 255, 255, ${0.08 + ((index + 3) % 3) * 0.04})`;
      context.fillRect(x - radius, y + index * radius * 0.26 + Math.sin(time + index) * 2, radius * 2, radius * 0.12);
    }

    if (body.id === "jupiter") {
      context.fillStyle = `rgba(208, 96, 48, ${highlight ? 0.48 : 0.28})`;
      context.beginPath();
      context.ellipse(x + radius * 0.18, y + radius * 0.16, radius * 0.22, radius * 0.14, 0.4, 0, Math.PI * 2);
      context.fill();
    }
  } else if (body.id === "mars") {
    for (let index = 0; index < 3; index += 1) {
      context.fillStyle = `rgba(255, 208, 170, ${highlight ? 0.18 : 0.1})`;
      context.beginPath();
      context.arc(
        x + Math.cos(time * 0.8 + index * 2.1) * radius * 0.18,
        y + Math.sin(time * 0.5 + index) * radius * 0.18,
        radius * (0.3 - index * 0.05),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  } else if (body.id === "venus") {
    context.fillStyle = `rgba(255, 244, 220, ${highlight ? 0.24 : 0.14})`;
    for (let index = 0; index < 4; index += 1) {
      context.beginPath();
      context.ellipse(x, y + Math.sin(time * 0.5 + index) * radius * 0.14, radius * (0.88 - index * 0.1), radius * 0.1, index * 0.3, 0, Math.PI * 2);
      context.fill();
    }
  } else if (body.id === "neptune" || body.id === "uranus") {
    for (let index = -2; index <= 2; index += 1) {
      context.strokeStyle = `rgba(255, 255, 255, ${highlight ? 0.24 : 0.12})`;
      context.lineWidth = 1.4;
      context.beginPath();
      context.arc(x, y + index * radius * 0.16, radius * 0.84, 0.1, Math.PI - 0.1);
      context.stroke();
    }
  } else if (body.id === "mercury") {
    context.fillStyle = "rgba(32, 18, 10, 0.26)";
    for (let index = 0; index < 6; index += 1) {
      context.beginPath();
      context.arc(
        x + Math.cos(index * 1.1) * radius * 0.38,
        y + Math.sin(index * 0.9) * radius * 0.32,
        radius * 0.12,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }

  context.restore();

  if (body.id === "saturn") {
    context.strokeStyle = `rgba(233, 213, 182, ${highlight ? 0.7 : 0.45})`;
    context.lineWidth = radius * 0.18;
    context.beginPath();
    context.ellipse(x, y, radius * 1.9, radius * 0.56, -0.22, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = `rgba(120, 98, 72, ${highlight ? 0.6 : 0.36})`;
    context.lineWidth = radius * 0.08;
    context.beginPath();
    context.ellipse(x, y, radius * 1.55, radius * 0.42, -0.22, 0, Math.PI * 2);
    context.stroke();
  }

  if (highlight) {
    context.strokeStyle = "rgba(255, 207, 136, 0.56)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(x, y, radius * 1.32, 0, Math.PI * 2);
    context.stroke();
  }
}

export function SolarSystemExperience({ blackHoleScene }: SolarSystemExperienceProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [blackHoleVisible, setBlackHoleVisible] = useState(false);
  const [sensorState, setSensorState] = useState<SensorState>("searching");
  const [statusLabel, setStatusLabel] = useState("Searching for hands");
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const trackingFrameRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const viewportRef = useRef({ width: 1280, height: 720 });
  const bodyScreenRef = useRef<BodyScreen[]>([]);
  const brightnessRef = useRef(255);
  const brightnessSampleFrameRef = useRef(0);
  const leftPinchedRef = useRef(false);
  const menuCooldownUntilRef = useRef(0);
  const menuReturnArmedAtRef = useRef<number | null>(null);
  const leftBackArmedAtRef = useRef<number | null>(null);
  const blackHoleArmedAtRef = useRef<number | null>(null);
  const viewRef = useRef({
    cameraX: -90,
    cameraY: 0,
    manualX: 0,
    manualY: 0,
    zoom: 1.08,
    targetZoom: SYSTEM_ZOOM,
  });
  const dragStateRef = useRef({
    active: false,
    anchorX: 0,
    anchorY: 0,
    manualX: 0,
    manualY: 0,
  });
  const selectedIdRef = useRef<string | null>(selectedId);
  const hoveredIdRef = useRef<string | null>(null);
  const blackHoleVisibleRef = useRef(false);
  const stars = useMemo(() => seededStars(320), []);

  function returnToSolarOverview() {
    selectedIdRef.current = null;
    hoveredIdRef.current = null;
    blackHoleVisibleRef.current = false;
    setSelectedId(null);
    setHoveredId(null);
    setBlackHoleVisible(false);
    viewRef.current.manualX = 0;
    viewRef.current.manualY = 0;
    viewRef.current.targetZoom = SYSTEM_ZOOM;
  }

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    blackHoleVisibleRef.current = blackHoleVisible;
  }, [blackHoleVisible]);

  useEffect(() => {
    const onResize = () => {
      viewportRef.current = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    };

    onResize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

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

        drawPreview(previewCanvasRef.current, videoRef.current, hands, pointerHand, leftHand, !!(leftHand && isPinched(leftHand)));

        if (!pointerHand) {
          setSensorState(brightnessRef.current < LOW_LIGHT_THRESHOLD ? "low-light" : "searching");
          setStatusLabel(brightnessRef.current < LOW_LIGHT_THRESHOLD ? "Low light" : "Searching for hands");
          leftPinchedRef.current = false;
          dragStateRef.current.active = false;
          menuReturnArmedAtRef.current = null;
          leftBackArmedAtRef.current = null;
          blackHoleArmedAtRef.current = null;
          hoveredIdRef.current = null;
          setHoveredId(null);
          trackingFrameRef.current = requestAnimationFrame(loop);
          return;
        }

        const { width, height } = viewportRef.current;
        const targetPointer = mapPointer(pointerHand[8], width, height, getHandScale(pointerHand));
        const nextPointer = {
          x: lerp(pointerRef.current.x || targetPointer.x, targetPointer.x, POINTER_SMOOTHING),
          y: lerp(pointerRef.current.y || targetPointer.y, targetPointer.y, POINTER_SMOOTHING),
        };
        pointerRef.current = nextPointer;
        setPointer(nextPointer);

        const rightPinched = isPinched(pointerHand);
        if (rightPinched) {
          if (!dragStateRef.current.active) {
            dragStateRef.current = {
              active: true,
              anchorX: pointerHand[8].x,
              anchorY: pointerHand[8].y,
              manualX: viewRef.current.manualX,
              manualY: viewRef.current.manualY,
            };
          } else {
            const deltaX = pointerHand[8].x - dragStateRef.current.anchorX;
            const deltaY = pointerHand[8].y - dragStateRef.current.anchorY;
            const worldScale = 460 / viewRef.current.zoom;
            viewRef.current.manualX = dragStateRef.current.manualX - deltaX * worldScale;
            viewRef.current.manualY = dragStateRef.current.manualY - deltaY * worldScale;
          }
        } else {
          dragStateRef.current.active = false;
        }

        const leftClustered = leftHand ? isHandClustered(leftHand) : false;
        const leftOpen = leftHand ? isOpenPalm(leftHand) : false;
        const leftPinched = leftHand ? isPinched(leftHand) : false;
        const rightOpen = isOpenPalm(pointerHand);
        const rightClustered = isHandClustered(pointerHand);
        const bothOpen = Boolean(
          leftHand &&
            leftOpen &&
            rightOpen &&
            !leftPinched &&
            !rightPinched &&
            !leftClustered &&
            !rightClustered,
        );

        if (
          selectedIdRef.current &&
          viewRef.current.targetZoom <= FOCUS_EXIT_ZOOM &&
          viewRef.current.zoom <= FOCUS_EXIT_ZOOM + 0.1
        ) {
          selectedIdRef.current = null;
          setSelectedId(null);
          hoveredIdRef.current = null;
          setHoveredId(null);
          viewRef.current.manualX = 0;
          viewRef.current.manualY = 0;
          viewRef.current.targetZoom = SYSTEM_ZOOM;
        }

        if (!blackHoleVisibleRef.current && bothOpen) {
          if (!blackHoleArmedAtRef.current) {
            blackHoleArmedAtRef.current = now;
          } else if (now - blackHoleArmedAtRef.current >= BLACK_HOLE_HOLD_MS) {
            blackHoleVisibleRef.current = true;
            setBlackHoleVisible(true);
            blackHoleArmedAtRef.current = null;
            menuCooldownUntilRef.current = now + MENU_ENTRY_COOLDOWN_MS;
          }
        } else if (!bothOpen) {
          blackHoleArmedAtRef.current = null;
        }

        if (leftClustered && !rightClustered && now >= menuCooldownUntilRef.current) {
          if (!leftBackArmedAtRef.current) {
            leftBackArmedAtRef.current = now;
          } else if (now - leftBackArmedAtRef.current >= MENU_RETURN_HOLD_MS) {
            menuCooldownUntilRef.current = now + MENU_ENTRY_COOLDOWN_MS;
            if (selectedIdRef.current) {
              viewRef.current.targetZoom = SYSTEM_ZOOM;
            } else if (!blackHoleVisibleRef.current) {
              sessionStorage.setItem(GLOBAL_MENU_FLAG_KEY, "1");
              router.push("/");
              return;
            }
            leftBackArmedAtRef.current = null;
          }
        } else {
          leftBackArmedAtRef.current = null;
        }

        if (leftClustered && rightClustered && now >= menuCooldownUntilRef.current) {
          if (!menuReturnArmedAtRef.current) {
            menuReturnArmedAtRef.current = now;
          } else if (now - menuReturnArmedAtRef.current >= MENU_RETURN_HOLD_MS) {
            menuCooldownUntilRef.current = now + MENU_ENTRY_COOLDOWN_MS;
            if (blackHoleVisibleRef.current) {
              returnToSolarOverview();
            } else {
              sessionStorage.setItem(GLOBAL_MENU_FLAG_KEY, "1");
              router.push("/");
              return;
            }
          }
        } else {
          menuReturnArmedAtRef.current = null;
        }

        const hoveredBody =
          selectedIdRef.current || blackHoleVisibleRef.current
            ? null
            : bodyScreenRef.current
                .slice()
                .reverse()
                .find(
                  (entry) =>
                    distance({ x: nextPointer.x, y: nextPointer.y }, { x: entry.x, y: entry.y }) <=
                    entry.radius * 1.15,
                );
        const hovered = hoveredBody?.body.id ?? null;
        if (hovered !== hoveredIdRef.current) {
          hoveredIdRef.current = hovered;
          setHoveredId(hovered);
        }

        if (leftPinched && !leftPinchedRef.current && hoveredBody && now >= menuCooldownUntilRef.current) {
          selectedIdRef.current = hoveredBody.body.id;
          setSelectedId(hoveredBody.body.id);
          blackHoleVisibleRef.current = false;
          setBlackHoleVisible(false);
          viewRef.current.manualX = 0;
          viewRef.current.manualY = 0;
          viewRef.current.targetZoom = hoveredBody.body.id === "sun" ? SUN_FOCUS_ZOOM : FOCUS_ZOOM_STEP;
        }
        leftPinchedRef.current = leftPinched;

        setSensorState(brightnessRef.current < LOW_LIGHT_THRESHOLD ? "low-light" : "tracking");
        setStatusLabel(
          brightnessRef.current < LOW_LIGHT_THRESHOLD
            ? "Low light"
            : blackHoleVisibleRef.current
              ? "Singularity view active"
              : selectedIdRef.current
                ? "Surface focus live"
                : "Orbit controls live",
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

  useEffect(() => {
    const render = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      const { width, height } = viewportRef.current;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      context.fillStyle = "#010208";
      context.fillRect(0, 0, width, height);

      stars.forEach((star) => {
        context.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
        context.beginPath();
        context.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2);
        context.fill();
      });

      const time = now * 0.0012;
      const selectedBody = selectedIdRef.current ? BODY_LOOKUP[selectedIdRef.current] : null;
      const baseCameraX = selectedBody ? 0 : -90;
      const baseCameraY = 0;
      viewRef.current.cameraX = lerp(viewRef.current.cameraX, baseCameraX + viewRef.current.manualX, 0.08);
      viewRef.current.cameraY = lerp(viewRef.current.cameraY, baseCameraY + viewRef.current.manualY, 0.08);
      viewRef.current.zoom = lerp(viewRef.current.zoom, viewRef.current.targetZoom, 0.08);

      const sceneCenterX = selectedBody ? width * 0.24 : width * 0.42;
      const sceneCenterY = selectedBody ? height * 0.54 : height * 0.56;
      const toScreen = (x: number, y: number) => ({
        x: sceneCenterX + (x - viewRef.current.cameraX) * viewRef.current.zoom,
        y: sceneCenterY + (y - viewRef.current.cameraY) * viewRef.current.zoom,
      });

      bodyScreenRef.current = [];
      if (selectedBody) {
        context.fillStyle = "rgba(255, 255, 255, 0.03)";
        for (let index = 0; index < 6; index += 1) {
          context.beginPath();
          context.arc(
            sceneCenterX - width * 0.03,
            sceneCenterY + height * 0.02,
            width * (0.1 + index * 0.04),
            0,
            Math.PI * 2,
          );
          context.fill();
        }

        const focusRadius = clamp(
          selectedBody.radius * viewRef.current.zoom * (selectedBody.id === "sun" ? 1.7 : 1.42),
          selectedBody.id === "sun" ? 150 : 110,
          selectedBody.id === "sun" ? 300 : 220,
        );
        const focusX = sceneCenterX + viewRef.current.manualX * 0.42;
        const focusY = sceneCenterY + viewRef.current.manualY * 0.3;

        drawPlanetEffect(context, selectedBody, focusX, focusY, focusRadius, time, true);

        selectedBody.moons.forEach((moon, index) => {
          const moonAngle = time * (1.2 + index * 0.32) / moon.orbitPeriod;
          const orbitRadius = focusRadius * (1.24 + index * 0.18);
          const moonX = focusX + Math.cos(moonAngle) * orbitRadius;
          const moonY = focusY + Math.sin(moonAngle) * orbitRadius * 0.24;
          context.strokeStyle = "rgba(255, 255, 255, 0.12)";
          context.lineWidth = 1;
          context.beginPath();
          context.ellipse(focusX, focusY, orbitRadius, orbitRadius * 0.24, 0, 0, Math.PI * 2);
          context.stroke();
          context.fillStyle = moon.tint;
          context.beginPath();
          context.arc(moonX, moonY, clamp(moon.radius * 0.72, 2.2, 8), 0, Math.PI * 2);
          context.fill();
        });
      } else {
        context.strokeStyle = "rgba(255, 255, 255, 0.08)";
        context.lineWidth = 1;
        SOLAR_BODIES.filter((body) => body.orbitRadius > 0).forEach((body) => {
          const orbitRadius = body.orbitRadius * viewRef.current.zoom;
          context.beginPath();
          context.ellipse(
            sceneCenterX - viewRef.current.cameraX * viewRef.current.zoom,
            sceneCenterY - viewRef.current.cameraY * viewRef.current.zoom,
            orbitRadius,
            orbitRadius * body.orbitTilt,
            0,
            0,
            Math.PI * 2,
          );
          context.stroke();
        });

        SOLAR_BODIES.forEach((body) => {
          const world = orbitPosition(body, time);
          const screen = toScreen(world.x, world.y);
          const radius = clamp(
            body.radius * viewRef.current.zoom * 0.36,
            body.id === "sun" ? 22 : 4,
            body.id === "sun" ? 88 : 38,
          );
          const highlight = body.id === hoveredIdRef.current;
          drawPlanetEffect(context, body, screen.x, screen.y, radius, time, highlight);

          if (body.moons.length > 0) {
            body.moons.forEach((moon, index) => {
              const moonAngle = time * (1.8 + index * 0.35) / moon.orbitPeriod;
              const moonX = screen.x + Math.cos(moonAngle) * moon.orbitRadius * viewRef.current.zoom * 0.18;
              const moonY = screen.y + Math.sin(moonAngle) * moon.orbitRadius * viewRef.current.zoom * 0.12;
              context.strokeStyle = "rgba(255, 255, 255, 0.1)";
              context.lineWidth = 0.8;
              context.beginPath();
              context.arc(screen.x, screen.y, moon.orbitRadius * viewRef.current.zoom * 0.18, 0, Math.PI * 2);
              context.stroke();
              context.fillStyle = moon.tint;
              context.beginPath();
              context.arc(
                moonX,
                moonY,
                clamp(moon.radius * viewRef.current.zoom * 0.18, 1.2, 4.6),
                0,
                Math.PI * 2,
              );
              context.fill();
            });
          }

          if (highlight) {
            context.strokeStyle = "rgba(255, 196, 134, 0.26)";
            context.setLineDash([4, 6]);
            context.beginPath();
            context.arc(screen.x, screen.y, radius * 1.6, 0, Math.PI * 2);
            context.stroke();
            context.setLineDash([]);
          }

          bodyScreenRef.current.push({
            x: screen.x,
            y: screen.y,
            radius,
            body,
          });
        });
      }

      if (!selectedBody && hoveredIdRef.current) {
        const hoveredEntry = bodyScreenRef.current.find((entry) => entry.body.id === hoveredIdRef.current);
        if (hoveredEntry) {
          context.fillStyle = "rgba(255, 255, 255, 0.84)";
          context.font = "500 12px ui-sans-serif, system-ui, sans-serif";
          context.fillText(hoveredEntry.body.name, hoveredEntry.x + hoveredEntry.radius + 12, hoveredEntry.y - hoveredEntry.radius - 6);
        }
      }

      frameRef.current = requestAnimationFrame(render);
    };

    frameRef.current = requestAnimationFrame(render);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [selectedId, stars]);

  const selected = selectedId ? BODY_LOOKUP[selectedId] : null;

  return (
    <main className={styles.shell}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      {blackHoleVisible ? (
        <div className={styles.blackHoleOverlay}>
          <div className={styles.blackHoleScene}>{blackHoleScene}</div>
          <div className={styles.blackHoleCaption}>
            <span className={styles.blackHoleLabel}>Singularity</span>
            <span className={styles.blackHoleHint}>Both fists to close</span>
          </div>
        </div>
      ) : null}
      <div className={styles.overlay}>
        <Link href="/" className={styles.backLink}>
          Back to dock
        </Link>

        {selected ? (
          <section className={styles.focusBadge}>
            <p className={styles.eyebrow}>Surface Focus</p>
            <h1 className={styles.focusTitle}>{selected.name}</h1>
            <p className={styles.copy}>{selected.surfaceFocus}</p>
          </section>
        ) : (
          <section className={styles.hero}>
            <p className={styles.eyebrow}>Solar Project</p>
            <h1 className={styles.title}>Solar Orrery</h1>
            <p className={styles.copy}>
              Procedural planets orbit the sun in real time. Right pinch drags the field, left pinch selects a body, and left fist pulls back out of focus.
            </p>
            <div className={styles.chipRow}>
              <span className={styles.chip}>All planets + key moons</span>
              <span className={styles.chip}>No external texture files</span>
              <span className={styles.chip}>Gesture atlas</span>
            </div>
          </section>
        )}

        <aside className={`${styles.detailCard} ${selected ? styles.detailCardFocused : ""}`}>
          {selected ? (
            <>
              <p className={styles.detailEyebrow}>
                {selected.accent} / {selected.effectLabel}
              </p>
              <h2 className={styles.detailTitle}>{selected.name}</h2>
              <p className={styles.detailCopy}>{selected.description}</p>
              <div className={styles.detailMeta}>
                <span className={styles.metaPill}>{selected.atmosphereLabel}</span>
                <span className={styles.metaPill}>{selected.moons.length} major moons</span>
                <span className={styles.metaPill}>Zoom out to return</span>
              </div>
              <div className={styles.featureList}>
                {selected.traits.map((trait) => (
                  <div key={trait} className={styles.featureItem}>
                    <span className={styles.featureBullet} aria-hidden="true" />
                    <span className={styles.featureCopy}>{trait}</span>
                  </div>
                ))}
              </div>
              {selected.moons.length > 0 ? (
                <div className={styles.moonList}>
                  {selected.moons.map((moon) => (
                    <div key={moon.name} className={styles.moonItem}>
                      <span className={styles.moonName}>{moon.name}</span>
                      <span className={styles.moonNote}>{moon.note}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className={styles.detailEyebrow}>System Overview / Procedural</p>
              <h2 className={styles.detailTitle}>Select A Body</h2>
              <p className={styles.detailCopy}>
                Every planet and key moon is generated in code, not from external texture files. Use the right hand to drag the atlas, left pinch to select a target, and left fist to back out.
              </p>
              <div className={styles.detailMeta}>
                <span className={styles.metaPill}>9 primary bodies</span>
                <span className={styles.metaPill}>Major moons included</span>
                <span className={styles.metaPill}>Procedural atmosphere FX</span>
              </div>
            </>
          )}
        </aside>

        <div className={styles.hintBar}>
          <span className={styles.hint}>Right pinch + move: drag view</span>
          <span className={styles.hint}>Left pinch: click / focus</span>
          <span className={styles.hint}>Left fist: zoom out / return</span>
          <span className={styles.hint}>Both open hands: black hole</span>
          <span className={styles.hint}>Both fists: close singularity / return to menu</span>
        </div>
      </div>

      <div
        className={`${styles.reticle} ${hoveredId ? styles.reticleActive : ""}`}
        style={{ transform: `translate3d(${pointer.x}px, ${pointer.y}px, 0)` }}
      >
        <div className={styles.reticleCore} />
      </div>

      <div className={styles.statusDock}>
        <div className={styles.statusPill}>
          <span
            className={`${styles.statusDot} ${
              sensorState === "camera-blocked"
                ? styles.blocked
                : sensorState === "low-light"
                  ? styles.warning
                  : styles.live
            }`}
          />
          <span>{statusLabel}</span>
        </div>
        <video ref={videoRef} className={styles.previewVideo} autoPlay muted playsInline />
        <canvas ref={previewCanvasRef} className={styles.previewCanvas} />
      </div>
    </main>
  );
}
