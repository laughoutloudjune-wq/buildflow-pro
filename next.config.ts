import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // @sparticuz/chromium ships its Chromium binary as a file it reads at
  // runtime via require.resolve - bundling it with webpack/turbopack breaks
  // that lookup, so it (and puppeteer-core, which loads it) must stay a
  // plain node_modules require in the deployed function.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  // serverExternalPackages alone keeps the package un-bundled but Next's own
  // file tracer still didn't pick up its ~67MB bin/ directory (the compressed
  // Chromium binary) since nothing statically requires those files by path -
  // this route 500'd in production with "input directory .../bin does not
  // exist" until they were force-included.
  outputFileTracingIncludes: {
    "/**/*": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
