// import withBundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';
import { withMonocle } from 'monocle2ai/next';
import './src/libs/Env';

// const bundleAnalyzer = withBundleAnalyzer({
//   enabled: process.env.ANALYZE === 'true',
// });

const nextConfig: NextConfig = {
  eslint: {
    dirs: ['.'],
    ignoreDuringBuilds: true,
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withMonocle(nextConfig, {
  // instrumented packages this app uses that aren't in the safe defaults
  // (openai, @langchain/core, llamaindex, monocle2ai and the hook shims are already covered)
  externalPackages: ['langchain', '@langchain/openai'],
});
