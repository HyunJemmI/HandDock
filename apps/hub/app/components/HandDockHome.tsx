"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../page.module.css";
import { works } from "../work-data";

type Landmark = { x: number; y: number };
type Mode = "landing" | "menu";
type Gesture = "open" | "clenched" | "grab" | "neutral" | "searching";
type TrailPoint = { x: number; y: number; time: number };
type Rotation = { x: number; y: number };
type Viewport = { width: number; height: number };

type TrackingState = {
  gesture: Gesture;
  hoveredAction: string | null;
};

type VisionModule = {
  FilesetResolver: {
    forVisionTasks: (path: string) => Promise<unknown>;
  };
  HandLandmarker: {
    createFromOptions: (
      resolver: unknown,
      options: Record<string, unknown>,
    ) => Promise<{
      close: () => void;
      detectForVideo: (
        video: HTMLVideoElement,
        now: number,
      ) => {
        landmarks: Array<Array<Landmark>>;
        handedness?: Array<Array<{ categoryName: string }>>;
      };
    }>;
  };
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
};

const MENU_BUTTON_ID = "menu-button";
const SWIPE_WINDOW_MS = 220;
const POINTER_SMOOTHING = 0.3;
const CURSOR_GAIN_X = 1.75;
const CURSOR_GAIN_Y = 1.55;
const CLUSTER_THRESHOLD = 0.48;
const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;
const FINGERTIP_COLORS = ["#f7c66a", "#8af4dd", "#f4f7fb", "#f39bd8", "#78b9ff"];
const MENU_POINTS = [
  { x: -0.95, y: -0.22, z: 0.38 },
  { x: 0.68, y: -0.35, z: 0.82 },
  { x: 0.22, y: 0.9, z: -0.18 },
  { x: -0.36, y: 0.62, z: 0.56 },
  { x: 0.94, y: 0.16, z: 0.08 },
] as const;
const loadVisionModule = new Function("moduleUrl", "return import(moduleUrl)") as (
  moduleUrl: string,
) => Promise<VisionModule>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function distance(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function averagePoint(points: Landmark[]) {
  const total = points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function getHandScale(points: Landmark[]) {
  return distance(points[5], points[17]) || 1;
}

function getLargestHand(hands: Landmark[][]) {
  return [...hands].sort((left, right) => getHandScale(right) - getHandScale(left))[0];
}

function splitHandsBySide(
  hands: Landmark[][],
  handedness: Array<Array<{ categoryName: string }>> | undefined,
) {
  const pairs = hands.map((hand, index) => ({
    hand,
    side: handedness?.[index]?.[0]?.categoryName?.toLowerCase() ?? "",
  }));

  const rightHand = pairs.find((pair) => pair.side === "right")?.hand;
  const leftHand = pairs.find((pair) => pair.side === "left")?.hand;

  return {
    rightHand: rightHand ?? getLargestHand(hands),
    leftHand: leftHand ?? (hands.length > 1 ? hands.find((hand) => hand !== rightHand) : undefined),
  };
}

function getGripPoint(points: Landmark[]) {
  return averagePoint(FINGERTIP_INDICES.map((index) => points[index]));
}

function isFingerExtended(points: Landmark[], tipIndex: number, pipIndex: number) {
  return points[tipIndex].y < points[pipIndex].y;
}

function isOpenPalm(points: Landmark[]) {
  const extendedCount = [
    isFingerExtended(points, 8, 6),
    isFingerExtended(points, 12, 10),
    isFingerExtended(points, 16, 14),
    isFingerExtended(points, 20, 18),
  ].filter(Boolean).length;

  const scale = getHandScale(points);
  const spread = distance(points[8], points[20]) / scale;
  const indexLift = (points[5].y - points[8].y) / scale;
  const middleLift = (points[9].y - points[12].y) / scale;

  return extendedCount >= 3 && spread > 1.35 && indexLift > 0.7 && middleLift > 0.7;
}

function isHandClustered(points: Landmark[]) {
  const scale = getHandScale(points);
  const centroid = getGripPoint(points);
  const spread =
    FINGERTIP_INDICES.reduce((sum, index) => sum + distance(points[index], centroid), 0) /
    (FINGERTIP_INDICES.length * scale);

  return spread < CLUSTER_THRESHOLD;
}

function mapPointer(point: Landmark, viewport: Viewport) {
  const normalizedX = clamp01(((1 - point.x) - 0.5) * CURSOR_GAIN_X + 0.5);
  const normalizedY = clamp01((point.y - 0.5) * CURSOR_GAIN_Y + 0.5);

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
  const cardHeightEstimate = 134;
  const cardInset = 28;
  const cardGap = 28;

  const nodes = works.map((work, index) => {
    const rotated = rotatePoint(MENU_POINTS[index % MENU_POINTS.length], rotation);
    const depth = (rotated.z + 1) / 2;
    const x = centerX + rotated.x * radius;
    const y = centerY + rotated.y * radius * 0.72;
    const size = 26 + depth * 26;
    const cardSide = rotated.x >= 0 ? 1 : -1;
    const rawCardX =
      x + cardSide * (size * 0.72 + cardGap) - (cardSide < 0 ? cardWidth : 0);
    const cardX = clamp(rawCardX, cardInset, viewport.width - cardWidth - cardInset);
    const cardY = clamp(
      y - cardHeightEstimate * 0.42,
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
      const minimumY = previous.cardY + cardHeightEstimate - 18;

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

function detectBackSwipe(trail: TrailPoint[], viewport: Viewport) {
  if (trail.length < 3) {
    return false;
  }

  const start = trail[0];
  const end = trail[trail.length - 1];
  const duration = end.time - start.time;

  return (
    duration <= SWIPE_WINDOW_MS &&
    start.y < viewport.height * 0.22 &&
    end.y > viewport.height * 0.72 &&
    start.x > viewport.width * 0.56 &&
    end.x < viewport.width * 0.5
  );
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
  const buttons = phase === "up" ? 0 : phase === "down" ? 1 : 1;
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

export function HandDockHome({ brainScene, robotScene }: HandDockHomeProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("landing");
  const [state, setState] = useState<TrackingState>({
    gesture: "searching",
    hoveredAction: null,
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
  const frameRef = useRef<number | null>(null);
  const armedActionRef = useRef<string | null>(null);
  const previousGestureRef = useRef<Gesture>("searching");
  const grabAnchorRef = useRef<Landmark | null>(null);
  const brainDragActiveRef = useRef(false);
  const rotationDragMovedRef = useRef(false);
  const swipeTrailRef = useRef<TrailPoint[]>([]);
  const modeRef = useRef<Mode>("landing");

  const menuLayout = useMemo(() => buildMenuNodes(viewport, rotation), [viewport, rotation]);

  function openMenu() {
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
    let handLandmarker: {
      close: () => void;
      detectForVideo: (
        video: HTMLVideoElement,
        now: number,
      ) => {
        landmarks: Array<Array<Landmark>>;
        handedness?: Array<Array<{ categoryName: string }>>;
      };
    } | null = null;
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

        const result = handLandmarker.detectForVideo(videoRef.current, performance.now());
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
          });
          frameRef.current = requestAnimationFrame(loop);
          return;
        }

        const targetPointer = mapPointer(pointerHand[8], viewport);
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
        drawFingertipPreview(
          previewCanvasRef.current,
          videoRef.current,
          hands,
          pointerHand,
          actionHand,
          leftClustered,
        );

        const hoveredAction =
          document
            .elementFromPoint(nextPointer.x, nextPointer.y)
            ?.closest("[data-action-id]")
            ?.getAttribute("data-action-id") ?? null;

        const isMenuDragArmed = modeRef.current === "menu" && leftClustered;
        if (leftClustered && hoveredAction && !rotationDragMovedRef.current) {
          armedActionRef.current = hoveredAction;
        }

        if (isMenuDragArmed) {
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

        swipeTrailRef.current = [
          ...swipeTrailRef.current.filter((item) => performance.now() - item.time < SWIPE_WINDOW_MS),
          { x: nextPointer.x, y: nextPointer.y, time: performance.now() },
        ];

        if (modeRef.current === "menu" && detectBackSwipe(swipeTrailRef.current, viewport)) {
          closeMenu();
          setState({
            gesture: "neutral",
            hoveredAction: null,
          });
          frameRef.current = requestAnimationFrame(loop);
          return;
        }

        const gesture: Gesture = isMenuDragArmed
          ? "grab"
          : leftClustered
            ? "clenched"
            : leftOpen
              ? "open"
              : "neutral";

        if (
          (previousGestureRef.current === "clenched" || previousGestureRef.current === "grab") &&
          gesture === "open" &&
          armedActionRef.current &&
          hoveredAction === armedActionRef.current &&
          !rotationDragMovedRef.current
        ) {
          activateAction(armedActionRef.current);
          armedActionRef.current = null;
        }

        if (!leftClustered && gesture !== "open") {
          armedActionRef.current = null;
        }

        if (!leftClustered) {
          rotationDragMovedRef.current = false;
        }

        previousGestureRef.current = gesture;
        setState({
          gesture,
          hoveredAction,
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
                y2={node.cardY + 44}
                className={styles.menuConnector}
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
              }}
            >
              <p className={styles.menuCardStatus}>{node.status}</p>
              <h2 className={styles.menuCardTitle}>{node.name}</h2>
              <p className={styles.menuCardCopy}>{node.description}</p>
              <div className={styles.menuCardMeta}>
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
          state.gesture === "clenched" || state.gesture === "grab" ? styles.reticleArmed : ""
        } ${state.gesture !== "searching" ? styles.reticleVisible : ""}`}
        style={{ transform: `translate3d(${pointer.x}px, ${pointer.y}px, 0)` }}
      >
        <div className={styles.reticleCore} />
      </div>

      <div className={styles.previewDock}>
        <video ref={videoRef} className={styles.previewVideo} autoPlay muted playsInline />
        <canvas ref={previewCanvasRef} className={styles.previewCanvas} />
      </div>
    </main>
  );
}
