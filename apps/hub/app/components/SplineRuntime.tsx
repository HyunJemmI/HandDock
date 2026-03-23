"use client";

import type { ComponentType } from "react";

// @ts-expect-error The package does not expose declarations for this internal bundle path.
import SplineRuntime from "../../../../node_modules/@splinetool/react-spline/dist/react-spline-next.js";

export default SplineRuntime as ComponentType<{ scene: string }>;
