import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Servidor autónomo para la imagen Docker (incluye solo lo necesario de node_modules)
  output: 'standalone',
  outputFileTracingRoot: root,
  poweredByHeader: false,
};
export default nextConfig;
