"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";
import {
  type VisionModule,
  clamp,
  clamp01,
  getHandScale,
  getLargestHand,
  isHandClustered,
  loadVisionModule,
  splitHandsBySide,
} from "./hand-tracking";

const EXIT_BUTTON_ID = "exit-button";
const EXIT_HOLD_MS = 220;

export function WorkGestureBack() {
  const router = useRouter();
  const frameRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const exitArmedAtRef = useRef<number | null>(null);
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);

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
            width: { ideal: 960 },
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

        const now = performance.now();
        const result = handLandmarker.detectForVideo(videoRef.current, now);
        const hands = result.landmarks;
        const { rightHand, leftHand } = splitHandsBySide(hands, result.handedness);
        const pointerHand = rightHand ?? getLargestHand(hands);
        const actionHand = leftHand;

        if (!pointerHand) {
          exitArmedAtRef.current = null;
          setHoveredAction(null);
          frameRef.current = requestAnimationFrame(loop);
          return;
        }

        const scale = getHandScale(pointerHand);
        const sensitivity = clamp(0.18 / scale, 0.9, 1.3);
        const x =
          clamp01(((1 - pointerHand[8].x) - 0.5) * 1.78 * sensitivity + 0.5) * window.innerWidth;
        const y = clamp01((pointerHand[8].y - 0.5) * 1.56 * sensitivity + 0.5) * window.innerHeight;
        const nextHoveredAction =
          document
            .elementFromPoint(x, y)
            ?.closest("[data-action-id]")
            ?.getAttribute("data-action-id") ?? null;
        setHoveredAction(nextHoveredAction);

        if (nextHoveredAction === EXIT_BUTTON_ID && actionHand && isHandClustered(actionHand)) {
          if (!exitArmedAtRef.current) {
            exitArmedAtRef.current = now;
          } else if (now - exitArmedAtRef.current >= EXIT_HOLD_MS) {
            exitArmedAtRef.current = null;
            setHoveredAction(null);
            router.push("/");
            return;
          }
        } else {
          exitArmedAtRef.current = null;
        }

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
      handLandmarker?.close();
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [router]);

  return (
    <>
      <button
        type="button"
        data-action-id={EXIT_BUTTON_ID}
        className={`${styles.exitButton} ${
          hoveredAction === EXIT_BUTTON_ID ? styles.exitButtonActive : ""
        }`}
      >
        Exit
      </button>
      <video
        ref={videoRef}
        style={{ position: "fixed", width: 1, height: 1, opacity: 0 }}
        autoPlay
        muted
        playsInline
      />
    </>
  );
}
