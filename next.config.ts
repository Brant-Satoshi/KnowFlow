import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // A stray lockfile in a parent directory makes Turbopack infer the wrong
  // workspace root and serve the wrong app tree in dev; pin it to this project.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
