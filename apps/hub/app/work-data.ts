export type WorkItem = {
  slug: string;
  name: string;
  description: string;
  status: string;
  stack: string[];
  year: string;
  interactionType: string;
  accentLabel: string;
  sceneAnchor: {
    x: number;
    y: number;
    z: number;
  };
  cardOffset: {
    x: number;
    y: number;
  };
  priority: number;
};

export const works: WorkItem[] = [
  {
    slug: "solar-orrery",
    name: "Solar Orrery",
    description:
      "A gesture-controlled solar system atlas with orbital motion, planetary zoom, and procedural atmospherics.",
    status: "In Progress",
    stack: ["Canvas", "MediaPipe", "Procedural FX"],
    year: "2026",
    interactionType: "Left pinch focus + right pinch drag",
    accentLabel: "Orbit",
    sceneAnchor: { x: -0.56, y: 0.08, z: 0.26 },
    cardOffset: { x: -10, y: 12 },
    priority: 4,
  },
  {
    slug: "nbv-robotics-lab",
    name: "NBV Robotics Lab",
    description:
      "Occlusion 환경에서 single-view semantic segmentation, information gain, 자동 NBV, 그리고 grasp planning을 시뮬레이션하는 브라우저 실험.",
    status: "Prototype",
    stack: ["Three.js", "MediaPipe", "Simulation"],
    year: "2026",
    interactionType: "Left fist drag + left pinch priority + right pinch grasp",
    accentLabel: "NBV",
    sceneAnchor: { x: 0.62, y: 0.14, z: 0.34 },
    cardOffset: { x: 14, y: -10 },
    priority: 5,
  },
];
