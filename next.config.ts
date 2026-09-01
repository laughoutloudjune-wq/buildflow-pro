import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // @sparticuz/chromium ships its Chromium binary as a file it reads at
  // runtime via require.resolve - bundling it with webpack/turbopack breaks
  // that lookup, so it (and puppeteer-core, which loads it) must stay a
  // plain node_modules require in the deployed function.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
};

export default nextConfig;
