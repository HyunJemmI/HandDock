"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type Landmark = { x: number; y: number };
type TrailPoint = { x: number; y: number; time: number };
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
      ) => { landmarks: Array<Array<Landmark>> };
    }>;
  };
};

const SWIPE_WINDOW_MS = 220;
const loadVisionModule = new Function("moduleUrl", "return import(moduleUrl)") as (
  moduleUrl: string,
) => Promise<VisionModule>;

function detectBackSwipe(trail: TrailPoint[]) {
  if (trail.length < 3) {
    return false;
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const start = trail[0];
  const end = trail[trail.length - 1];
  const duration = end.time - start.time;

  return (
    duration <= SWIPE_WINDOW_MS &&
    start.y < height * 0.22 &&
    end.y > height * 0.72 &&
    start.x > width * 0.56 &&
    end.x < width * 0.5
  );
}

export function WorkGestureBack() {
  const router = useRouter();
  const frameRef = useRef<number | null>(null);
  const trailRef = useRef<TrailPoint[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let handLandmarker: {
      close: () => void;
      detectForVideo: (
        video: HTMLVideoElement,
        now: number,
      ) => { landmarks: Array<Array<Landmark>> };
    } | null = null;
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
          numHands: 1,
        });
      } catch {
        handLandmarker = await vision.HandLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath: "/vendor/mediapipe/hand_landmarker.task",
          },
          runningMode: "VIDEO",
          numHands: 1,
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
        const hand = result.landmarks[0];

        if (!hand) {
          trailRef.current = [];
          frameRef.current = requestAnimationFrame(loop);
          return;
        }

        const x = (1 - hand[8].x) * window.innerWidth;
        const y = hand[8].y * window.innerHeight;
        trailRef.current = [
          ...trailRef.current.filter((item) => performance.now() - item.time < SWIPE_WINDOW_MS),
          { x, y, time: performance.now() },
        ];

        if (detectBackSwipe(trailRef.current)) {
          router.push("/");
          return;
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

  return <video ref={videoRef} style={{ position: "fixed", width: 1, height: 1, opacity: 0 }} autoPlay muted playsInline />;
}
