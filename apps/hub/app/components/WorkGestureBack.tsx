"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  GLOBAL_MENU_FLAG_KEY,
  SWIPE_WINDOW_MS,
  type TrailPoint,
  type VisionModule,
  detectBackSwipe,
  getLargestHand,
  isHandClustered,
  isOpenPalm,
  loadVisionModule,
  splitHandsBySide,
} from "./hand-tracking";

type Gesture = "open" | "clenched" | "neutral" | "searching";
const MENU_ENTRY_COOLDOWN_MS = 520;

export function WorkGestureBack() {
  const router = useRouter();
  const frameRef = useRef<number | null>(null);
  const trailRef = useRef<TrailPoint[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previousGestureRef = useRef<Gesture>("searching");
  const cooldownUntilRef = useRef(0);

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
          trailRef.current = [];
          previousGestureRef.current = "searching";
          frameRef.current = requestAnimationFrame(loop);
          return;
        }

        const x = (1 - pointerHand[8].x) * window.innerWidth;
        const y = pointerHand[8].y * window.innerHeight;
        trailRef.current = [
          ...trailRef.current.filter((item) => now - item.time < SWIPE_WINDOW_MS),
          { x, y, time: now },
        ];

        if (detectBackSwipe(trailRef.current, { width: window.innerWidth, height: window.innerHeight })) {
          router.push("/");
          return;
        }

        const nextGesture: Gesture = actionHand
          ? isHandClustered(actionHand)
            ? "clenched"
            : isOpenPalm(actionHand)
              ? "open"
              : "neutral"
          : "searching";

        if (
          previousGestureRef.current === "clenched" &&
          nextGesture === "open" &&
          now >= cooldownUntilRef.current
        ) {
          cooldownUntilRef.current = now + MENU_ENTRY_COOLDOWN_MS;
          sessionStorage.setItem(GLOBAL_MENU_FLAG_KEY, "1");
          router.push("/");
          return;
        }

        previousGestureRef.current = nextGesture;
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
    <video
      ref={videoRef}
      style={{ position: "fixed", width: 1, height: 1, opacity: 0 }}
      autoPlay
      muted
      playsInline
    />
  );
}
