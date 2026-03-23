export type WorkItem = {
  slug: string;
  name: string;
  description: string;
  status: string;
  stack: string[];
};

export const works: WorkItem[] = [
  {
    slug: "gesture-atrium",
    name: "Gesture Atrium",
    description:
      "Hand-tracking entrance hall for testing cursorless navigation and spatial selection.",
    status: "Prototype",
    stack: ["Spline", "MediaPipe", "Next.js"],
  },
  {
    slug: "spline-remix-lab",
    name: "Spline Remix Lab",
    description:
      "Community Spline scenes imported and reworked into reusable interactive modules.",
    status: "Collecting",
    stack: ["Spline", "Scene remix", "Adapter layer"],
  },
  {
    slug: "camera-rituals",
    name: "Camera Rituals",
    description:
      "A static archive slot for future vibe-coded works driven by camera, posture, and gesture.",
    status: "Reserved",
    stack: ["Camera", "Gesture", "Archive"],
  },
];
