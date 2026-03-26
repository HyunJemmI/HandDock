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
    interactionType: "Left pinch priority + right pinch grasp + speed drag",
    accentLabel: "NBV",
    sceneAnchor: { x: 0.62, y: 0.18, z: 0.34 },
    cardOffset: { x: 14, y: -10 },
    priority: 5,
  },
  {
    slug: "wall-cl",
    name: "WallCL",
    description:
      "벽을 오르는 클라이밍 로봇의 gait, 접촉 순서, 그리고 예상 하드웨어 구성을 함께 보여주는 인터랙티브 시뮬레이터.",
    status: "Prototype",
    stack: ["SVG", "Kinematics", "Hardware Design"],
    year: "2026",
    interactionType: "Auto climb simulation + gesture exit",
    accentLabel: "Climb",
    sceneAnchor: { x: -0.26, y: -0.32, z: 0.44 },
    cardOffset: { x: -12, y: 6 },
    priority: 4,
  },
  {
    slug: "lcl-contrast-lab",
    name: "LCL",
    description:
      "빛 노이즈 contrastive learning과 glare-robust line / obstacle detection을 한 화면에서 시각화하는 학습 데모.",
    status: "Prototype",
    stack: ["Canvas", "Visualization", "Contrastive Learning"],
    year: "2026",
    interactionType: "Auto training visualization + gesture exit",
    accentLabel: "Contrast",
    sceneAnchor: { x: 0.12, y: -0.42, z: 0.18 },
    cardOffset: { x: 10, y: 12 },
    priority: 4,
  },
];
