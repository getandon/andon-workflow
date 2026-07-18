import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { unpluginRouterGeneratorFactory, unpluginRouterCodeSplitterFactory } from '@tanstack/router-plugin';

const RouterGenerator = unpluginRouterGeneratorFactory({});
const RouterCodeSplitter = unpluginRouterCodeSplitterFactory({});

export default defineConfig({
  plugins: [RouterGenerator.vite, RouterCodeSplitter.vite, react(), tailwindcss(), tsconfigPaths()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
