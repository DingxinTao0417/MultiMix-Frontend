import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const editorRoot = path.resolve(dirname, "editor-engine/vendor/editor");

/** @type {import('next').NextConfig} */
const nextConfig = {
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
};

export default nextConfig;
