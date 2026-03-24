import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] === "build" ? "build" : "dev";
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const targetDir = resolve(rootDir, mode === "build" ? ".next-build" : ".next-dev");

rmSync(targetDir, { recursive: true, force: true });
