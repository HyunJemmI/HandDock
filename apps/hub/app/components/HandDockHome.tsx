"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../page.module.css";
import { works } from "../work-data";
import {
  FINGERTIP_INDICES,
  GLOBAL_MENU_FLAG_KEY,
  SWIPE_WINDOW_MS,
  type Landmark,
  type TrailPoint,
  type Viewport,
  type VisionModule,
  clamp,
  clamp01,
  detectBackSwipe,
  getGripPoint,
  getHandScale,
  getLargestHand,
  isHandClustered,
  isOpenPalm,
  loadVisionModule,
  splitHandsBySide,
} from "./hand-tracking";

type Mode = "landing" | "menu";
type Gesture = "open" | "clenched" | "grab" | "neutral" | "searching";
type Intent = "idle" | "menu-intent" | "selection" | "rotation" | "back-swipe";
type Rotation = { x: number; y: number };
type SensorState = "tracking" | "searching" | "camera-blocked" | "low-light";

type TrackingState = {
  gesture: Gesture;
  hoveredAction: string | null;
  intent: Intent;
  sensorState: SensorState;
  statusLabel: string;
};

type HandDockHomeProps = {
  brainScene: ReactNode;
  robotScene: ReactNode;
};

type MenuNode = {
  slug: string;
  name: string;
  description: string;
  status: string;
  stack: string[];
  year: string;
  interactionType: string;
  accentLabel: string;
  actionId: string;
  x: number;
  y: number;
  size: number;
  depth: number;
  visible: boolean;
  cardSide: -1 | 1;
  cardX: number;
  cardY: number;
  cardWidth: number;
  connectorX: number;
  cardScale: number;
  cardOpacity: number;
};

const MENU_BUTTON_ID = "menu-button";
const POINTER_SMOOTHING = 0.32;
const CURSOR_GAIN_X = 1.78;
const CURSOR_GAIN_Y = 1.58;
const MENU_ENTRY_COOLDOWN_MS = 520;
const LOW_LIGHT_THRESHOLD = 44;
const FINGERTIP_COLORS = ["#f7c66a", "#8af4dd", "#f4f7fb", "#f39bd8", "#78b9ff"];

function mapPointer(point: Landmark, viewport: Viewport, handScale: number) {
  const sensitivityFactor = clamp(0.18 / handScale, 0.88, 1.35);
  const gainX = CURSOR_GAIN_X * sensitivityFactor;
  const gainY = CURSOR_GAIN_Y * sensitivityFactor;
  const normalizedX = clamp01(((1 - point.x) - 0.5) * gainX + 0.5);
  const normalizedY = clamp01((point.y - 0.5) * gainY + 0.5);

  return {
    x: normalizedX * viewport.width,
    y: normalizedY * viewport.height,
  };
}

function rotatePoint(
  point: { x: number; y: number; z: number },
  rotation: Rotation,
) {
  const cosY = Math.cos(rotation.y);
  const sinY = Math.sin(rotation.y);
  const cosX = Math.cos(rotation.x);
  const sinX = Math.sin(rotation.x);

  const xzX = point.x * cosY - point.z * sinY;
  const xzZ = point.x * sinY + point.z * cosY;

  return {
    x: xzX,
    y: point.y * cosX - xzZ * sinX,
    z: point.y * sinX + xzZ * cosX,
  };
}

function buildMenuNodes(viewport: Viewport, rotation: Rotation) {
  const centerX = viewport.width * 0.5;
  const centerY = viewport.height * 0.5;
  const radius = Math.min(viewport.width, viewport.height) * 0.24;
  const cardWidth = clamp(viewport.width * 0.2, 200, 280);
  const cardHeightEstimate = 146;
  const cardInset = 28;
  const cardGap = 30;

  const nodes = works.map((work) => {
    const rotated = rotatePoint(work.sceneAnchor, rotation);
    const depth = (rotated.z + 1) / 2;
    const x = centerX + rotated.x * radius;
    const y = centerY + rotated.y * radius * 0.72;
    const size = 24 + depth * 28 + work.priority * 1.5;
    const cardSide = rotated.x >= 0 ? 1 : -1;
    const depthDrift = (depth - 0.5) * 22;
    const rawCardX =
      x +
      cardSide * (size * 0.78 + cardGap + work.cardOffset.x + depthDrift) -
      (cardSide < 0 ? cardWidth : 0);
    const cardX = clamp(rawCardX, cardInset, viewport.width - cardWidth - cardInset);
    const rawCardY = y - cardHeightEstimate * 0.42 + work.cardOffset.y - depthDrift * 0.35;
    const cardY = clamp(
      rawCardY,
      cardInset,
      viewport.height - cardHeightEstimate - cardInset,
    );

    return {
      ...work,
      actionId: `project:${work.slug}`,
      x,
      y,
      size,
      depth,
      visible: depth > 0.08,
      cardSide,
      cardX,
      cardY,
      cardWidth,
      connectorX: cardSide > 0 ? cardX : cardX + cardWidth,
      cardScale: 0.92 + depth * 0.12,
      cardOpacity: 0.5 + depth * 0.5,
    };
  });

  const visibleNodes = [-1, 1].flatMap((side) => {
    const sideNodes = nodes
      .filter((node) => node.visible && node.cardSide === side)
      .sort((left, right) => left.cardY - right.cardY)
      .map((node) => ({ ...node }));

    for (let index = 1; index < sideNodes.length; index += 1) {
      const previous = sideNodes[index - 1];
      const current = sideNodes[index];
      const minimumY = previous.cardY + cardHeightEstimate - 24;

      if (current.cardY < minimumY) {
        current.cardY = minimumY;
      }
    }

    const overflow =
      sideNodes.length > 0
        ? sideNodes[sideNodes.length - 1].cardY + cardHeightEstimate - (viewport.height - cardInset)
        : 0;

    if (overflow > 0) {
      sideNodes.forEach((node) => {
        node.cardY -= overflow;
      });
    }

    const topUnderflow = sideNodes.length > 0 ? cardInset - sideNodes[0].cardY : 0;
    if (topUnderflow > 0) {
      sideNodes.forEach((node) => {
        node.cardY += topUnderflow;
      });
    }

    return sideNodes.map((node) => ({
      ...node,
      connectorX: node.cardSide > 0 ? node.cardX : node.cardX + node.cardWidth,
    }));
  });

  return { nodes, visibleNodes };
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

function drawFingertipPreview(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  hands: Landmark[][],
  pointerHand: Landmark[] | undefined,
  actionHand: Landmark[] | undefined,
  actionArmed: boolean,
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
      context.lineWidth = handIndex === 0 ? 2.5 : 1.5;
      context.strokeStyle = "rgba(0, 0, 0, 0.65)";
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
    const grip = getGripPoint(actionHand);
    context.beginPath();
    context.moveTo(actionHand[8].x * canvas.width, actionHand[8].y * canvas.height);
    context.lineTo(grip.x * canvas.width, grip.y * canvas.height);
    context.lineWidth = 4;
    context.strokeStyle = actionArmed
      ? "rgba(247, 198, 106, 0.92)"
      : "rgba(255, 255, 255, 0.4)";
    context.stroke();
  }
}

function dispatchScenePointer(
  sceneRoot: HTMLDivElement | null,
  phase: "move" | "down" | "up",
  x: number,
  y: number,
) {
  const canvas = sceneRoot?.querySelector("canvas");
  if (!canvas) {
    return;
  }

  const pointerType =
    phase === "down" ? "pointerdown" : phase === "up" ? "pointerup" : "pointermove";
  const mouseType = phase === "down" ? "mousedown" : phase === "up" ? "mouseup" : "mousemove";
  const buttons = phase === "up" ? 0 : 1;
  const options = {
    clientX: x,
    clientY: y,
    bubbles: true,
    button: 0,
    buttons,
  };

  canvas.dispatchEvent(
    new PointerEvent(pointerType, {
      ...options,
      pointerType: "mouse",
      isPrimary: true,
    }),
  );
  canvas.dispatchEvent(new MouseEvent(mouseType, options));
}

export function HandDockHome({
  brainScene,
  robotScene,
}: HandDockHomeProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("landing");
  const [state, setState] = useState<TrackingState>({
    gesture: "searching",
    hoveredAction: null,
    intent: "idle",
    sensorState: "searching",
    statusLabel: "Searching for hand",
  });
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState<Rotation>({ x: -0.16, y: 0.22 });
  const [viewport, setViewport] = useState<Viewport>({ width: 1280, height: 720 });
  const pointerRef = useRef({ x: 0, y: 0 });
  const hasPointerRef = useRef(false);
  const robotSceneRef = useRef<HTMLDivElement | null>(null);
  const brainSceneRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const armedActionRef = useRef<string | null>(null);
  const previousGestureRef = useRef<Gesture>("searching");
  const grabAnchorRef = useRef<Landmark | null>(null);
  const brainDragActiveRef = useRef(false);
  const rotationDragMovedRef = useRef(false);
  const swipeTrailRef = useRef<TrailPoint[]>([]);
  const menuCooldownUntilRef = useRef(0);
  const brightnessRef = useRef(255);
  const brightnessSampleFrameRef = useRef(0);
  const modeRef = useRef<Mode>("landing");

  const menuLayout = useMemo(() => buildMenuNodes(viewport, rotation), [viewport, rotation]);

  useEffect(() => {
    if (sessionStorage.getItem(GLOBAL_MENU_FLAG_KEY) !== "1") {
      return;
    }

    sessionStorage.removeItem(GLOBAL_MENU_FLAG_KEY);
    menuCooldownUntilRef.current = performance.now() + MENU_ENTRY_COOLDOWN_MS;
    modeRef.current = "menu";
    setMode("menu");
  }, []);

  function openMenu() {
    if (modeRef.current === "menu") {
      return;
    }

    menuCooldownUntilRef.current = performance.now() + MENU_ENTRY_COOLDOWN_MS;
    modeRef.current = "menu";
    setMode("menu");
    armedActionRef.current = null;
    grabAnchorRef.current = null;
    brainDragActiveRef.current = false;
    rotationDragMovedRef.current = false;
    swipeTrailRef.current = [];
  }

  function closeMenu() {
    if (brainDragActiveRef.current) {
      dispatchScenePointer(brainSceneRef.current, "up", pointerRef.current.x, pointerRef.current.y);
    }
    modeRef.current = "landing";
    setMode("landing");
    armedActionRef.current = null;
    grabAnchorRef.current = null;
    brainDragActiveRef.current = false;
    rotationDragMovedRef.current = false;
    swipeTrailRef.current = [];
  }

  function activateAction(actionId: string) {
    if (actionId === MENU_BUTTON_ID) {
      openMenu();
      return;
    }

    if (actionId.startsWith("project:")) {
      const slug = actionId.replace("project:", "");
      router.push(`/works/${slug}`);
    }
  }

  function dispatchRobotPointer(x: number, y: number) {
    dispatchScenePointer(robotSceneRef.current, "move", x, y);
  }

  useEffect(() => {
    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let handLandmarker: Awaited<
      ReturnType<VisionModule["HandLandmarker"]["createFromOptions"]>
    > | null = null;
    let mounted = true;

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
          setState((current) => ({
            ...current,
            gesture: "searching",
            intent: "idle",
            sensorState: "camera-blocked",
            statusLabel: "Camera access blocked",
          }));
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

        brightnessSampleFrameRef.current += 1;
        if (lightCanvasRef.current && brightnessSampleFrameRef.current % 12 === 0) {
          brightnessRef.current = estimateBrightness(videoRef.current, lightCanvasRef.current);
        }

        const now = performance.now();
        const result = handLandmarker.detectForVideo(videoRef.current, now);
        const hands = result.landmarks;
        const { rightHand, leftHand } = splitHandsBySide(hands, result.handedness);
        const pointerHand = rightHand ?? getLargestHand(hands);
        const actionHand = leftHand;

        if (!pointerHand) {
          drawFingertipPreview(previewCanvasRef.current, videoRef.current, [], undefined, undefined, false);
          if (brainDragActiveRef.current) {
            dispatchScenePointer(
              brainSceneRef.current,
              "up",
              pointerRef.current.x,
              pointerRef.current.y,
            );
          }
          armedActionRef.current = null;
          grabAnchorRef.current = null;
          brainDragActiveRef.current = false;
          rotationDragMovedRef.current = false;
          swipeTrailRef.current = [];
          previousGestureRef.current = "searching";
          setState({
            gesture: "searching",
            hoveredAction: null,
            intent: "idle",
            sensorState: brightnessRef.current < LOW_LIGHT_THRESHOLD ? "low-light" : "searching",
            statusLabel:
              brightnessRef.current < LOW_LIGHT_THRESHOLD ? "Low light" : "Searching for hand",
          });
          frameRef.current = requestAnimationFrame(loop);
          return;
        }

        const targetPointer = mapPointer(pointerHand[8], viewport, getHandScale(pointerHand));
        if (!hasPointerRef.current) {
          pointerRef.current = targetPointer;
          hasPointerRef.current = true;
        }

        const nextPointer = {
          x: pointerRef.current.x + (targetPointer.x - pointerRef.current.x) * POINTER_SMOOTHING,
          y: pointerRef.current.y + (targetPointer.y - pointerRef.current.y) * POINTER_SMOOTHING,
        };
        pointerRef.current = nextPointer;
        setPointer(nextPointer);

        if (modeRef.current === "landing") {
          dispatchRobotPointer(nextPointer.x, nextPointer.y);
        }

        const leftOpen = actionHand ? isOpenPalm(actionHand) : false;
        const leftClustered = actionHand ? isHandClustered(actionHand) : false;
        const canTriggerPrimary = now >= menuCooldownUntilRef.current;
        const hoveredAction =
          document
            .elementFromPoint(nextPointer.x, nextPointer.y)
            ?.closest("[data-action-id]")
            ?.getAttribute("data-action-id") ?? null;

        const nextGesture: Gesture =
          modeRef.current === "menu" && leftClustered
            ? "grab"
            : leftClustered
              ? "clenched"
              : leftOpen
                ? "open"
                : "neutral";

        let nextIntent: Intent = "idle";
        let shouldContinue = false;

        drawFingertipPreview(
          previewCanvasRef.current,
          videoRef.current,
          hands,
          pointerHand,
          actionHand,
          leftClustered,
        );

        if (
          modeRef.current !== "menu" &&
          previousGestureRef.current === "clenched" &&
          nextGesture === "open" &&
          canTriggerPrimary
        ) {
          nextIntent = "menu-intent";
          openMenu();
          shouldContinue = true;
        }

        if (!shouldContinue && modeRef.current === "menu") {
          swipeTrailRef.current = [
            ...swipeTrailRef.current.filter((item) => now - item.time < SWIPE_WINDOW_MS),
            { x: nextPointer.x, y: nextPointer.y, time: now },
          ];

          if (detectBackSwipe(swipeTrailRef.current, viewport)) {
            nextIntent = "back-swipe";
            closeMenu();
            shouldContinue = true;
          }
        }

        if (!shouldContinue && modeRef.current === "menu" && leftClustered) {
          nextIntent = "rotation";
          if (!brainDragActiveRef.current) {
            dispatchScenePointer(brainSceneRef.current, "down", nextPointer.x, nextPointer.y);
            brainDragActiveRef.current = true;
          } else {
            dispatchScenePointer(brainSceneRef.current, "move", nextPointer.x, nextPointer.y);
          }

          const gripPoint = pointerHand[8];
          if (grabAnchorRef.current) {
            const deltaX = gripPoint.x - grabAnchorRef.current.x;
            const deltaY = gripPoint.y - grabAnchorRef.current.y;

            if (Math.abs(deltaX) + Math.abs(deltaY) > 0.012) {
              rotationDragMovedRef.current = true;
              armedActionRef.current = null;
            }

            setRotation((current) => ({
              x: clamp(current.x + deltaY * 4.1, -0.75, 0.75),
              y: current.y + deltaX * 6.2,
            }));
          }
          grabAnchorRef.current = gripPoint;
        } else {
          if (brainDragActiveRef.current) {
            dispatchScenePointer(brainSceneRef.current, "up", nextPointer.x, nextPointer.y);
          }
          brainDragActiveRef.current = false;
          grabAnchorRef.current = null;
        }

        if (
          !shouldContinue &&
          leftClustered &&
          hoveredAction &&
          canTriggerPrimary &&
          !rotationDragMovedRef.current
        ) {
          armedActionRef.current = hoveredAction;
        }

        if (
          !shouldContinue &&
          (previousGestureRef.current === "clenched" || previousGestureRef.current === "grab") &&
          nextGesture === "open" &&
          armedActionRef.current &&
          hoveredAction === armedActionRef.current &&
          canTriggerPrimary &&
          !rotationDragMovedRef.current
        ) {
          nextIntent = "selection";
          activateAction(armedActionRef.current);
          armedActionRef.current = null;
        }

        if (!leftClustered && nextGesture !== "open") {
          armedActionRef.current = null;
        }

        if (!leftClustered) {
          rotationDragMovedRef.current = false;
        }

        previousGestureRef.current = nextGesture;
        setState({
          gesture: nextGesture,
          hoveredAction,
          intent: nextIntent,
          sensorState: brightnessRef.current < LOW_LIGHT_THRESHOLD ? "low-light" : "tracking",
          statusLabel: brightnessRef.current < LOW_LIGHT_THRESHOLD ? "Low light" : "Hand tracking live",
        });

        frameRef.current = requestAnimationFrame(loop);
      };

      frameRef.current = requestAnimationFrame(loop);
    }

    setup();

    return () => {
      mounted = false;
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      if (brainDragActiveRef.current) {
        dispatchScenePointer(brainSceneRef.current, "up", pointerRef.current.x, pointerRef.current.y);
      }
      handLandmarker?.close();
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [router, viewport]);

  return (
    <main className={styles.shell}>
      <div
        ref={robotSceneRef}
        className={`${styles.sceneLayer} ${mode === "landing" ? styles.sceneLayerActive : ""}`}
        aria-hidden={mode !== "landing"}
      >
        {robotScene}
      </div>

      <div
        ref={brainSceneRef}
        className={`${styles.sceneLayer} ${mode === "menu" ? styles.sceneLayerActive : ""}`}
        aria-hidden={mode !== "menu"}
      >
        {brainScene}
      </div>

      <div className={styles.blackVignette} />

      {mode === "landing" ? (
        <button
          type="button"
          aria-label="Open project menu"
          data-action-id={MENU_BUTTON_ID}
          className={`${styles.menuTrigger} ${
            state.hoveredAction === MENU_BUTTON_ID ? styles.menuTriggerActive : ""
          }`}
        />
      ) : null}

      {mode === "menu" ? (
        <section className={styles.menuOverlay}>
          <svg className={styles.menuLines} aria-hidden="true">
            {menuLayout.visibleNodes.map((node) => (
              <line
                key={node.slug}
                x1={node.x}
                y1={node.y}
                x2={node.connectorX}
                y2={node.cardY + 46}
                className={styles.menuConnector}
                style={{ opacity: node.cardOpacity }}
              />
            ))}
          </svg>

          {menuLayout.nodes.map((node) =>
            node.visible ? (
              <button
                key={node.slug}
                type="button"
                aria-label={node.name}
                data-action-id={node.actionId}
                className={`${styles.projectOrb} ${
                  state.hoveredAction === node.actionId ? styles.projectOrbActive : ""
                }`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.size,
                  height: node.size,
                  zIndex: 20 + Math.round(node.depth * 10),
                  opacity: 0.62 + node.depth * 0.38,
                }}
              />
            ) : null,
          )}

          {menuLayout.visibleNodes.map((node) => (
            <article
              key={node.slug}
              className={`${styles.menuCard} ${
                state.hoveredAction === node.actionId ? styles.menuCardActive : ""
              }`}
              style={{
                left: node.cardX,
                top: node.cardY,
                width: node.cardWidth,
                ["--card-scale" as string]: node.cardScale.toString(),
                ["--card-opacity" as string]: node.cardOpacity.toString(),
              }}
            >
              <p className={styles.menuCardStatus}>
                {node.accentLabel} / {node.year}
              </p>
              <h2 className={styles.menuCardTitle}>{node.name}</h2>
              <p className={styles.menuCardCopy}>{node.description}</p>
              <div className={styles.menuCardMeta}>
                <span className={styles.menuMetaPill}>{node.status}</span>
                <span className={styles.menuMetaPill}>{node.interactionType}</span>
                {node.stack.map((item) => (
                  <span key={item} className={styles.menuMetaPill}>
                    {item}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <div
        className={`${styles.reticle} ${
          state.intent === "selection" || state.intent === "rotation" ? styles.reticleArmed : ""
        } ${state.gesture !== "searching" ? styles.reticleVisible : ""}`}
        style={{ transform: `translate3d(${pointer.x}px, ${pointer.y}px, 0)` }}
      >
        <div className={styles.reticleCore} />
      </div>

      <div className={styles.statusDock}>
        <span
          className={`${styles.statusDot} ${
            state.sensorState === "camera-blocked"
              ? styles.statusDotBlocked
              : state.sensorState === "low-light"
                ? styles.statusDotWarning
                : styles.statusDotLive
          }`}
          aria-hidden="true"
        />
        <span className={styles.statusLabel}>{state.statusLabel}</span>
      </div>

      <div className={styles.previewDock}>
        <video ref={videoRef} className={styles.previewVideo} autoPlay muted playsInline />
        <canvas ref={previewCanvasRef} className={styles.previewCanvas} />
      </div>
    </main>
  );
}
