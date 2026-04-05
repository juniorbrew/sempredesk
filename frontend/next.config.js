/** @type {import('next').NextConfig} */
const internalApiUrl =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000'

const nextConfig = {
  // Standalone só no Docker: `next start` local com `output: 'standalone'` quebra (500 / rotas App Router).
  ...(process.env.DOCKER_BUILD === '1' ? { output: 'standalone' } : {}),
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  async rewrites() {
    return [
      { source: '/manifest.json', destination: '/manifest' },
      // Proxy para o backend em desenvolvimento (next dev sem Nginx)
      {
        source: '/api/v1/:path*',
        destination: `${internalApiUrl}/api/v1/:path*`,
      },
    ];
  },
}

module.exports = nextConfig
