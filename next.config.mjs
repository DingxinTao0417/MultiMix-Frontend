import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const editorRoot = path.resolve(dirname, "editor-engine/vendor/editor");

/**
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
const createNextConfig = (phase) => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next" : ".next-build",
  devIndicators: false,
  webpack: (config) => {
    // Embedded video-studio editor (OpenCut) module aliases.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@editor": editorRoot,
      "@opencut/ui/icons": path.resolve(editorRoot, "icons/index.tsx"),
      "@opencut/env/web": path.resolve(editorRoot, "stubs/env.ts")
    };

    // Import .glsl shader files as raw strings (Vite glslPlugin equivalent).
    config.module.rules.push({
      test: /\.glsl$/,
      type: "asset/source"
    });

    return config;
  }
});

export default createNextConfig;
