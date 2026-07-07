import { defineConfig } from 'vite';

// GLOWDEAL 업체 관리자 — 로컬 개발: `npm run dev` (localhost, HMR)
// 배포 빌드: `npm run build` → dist/ (정적 번들)
export default defineConfig({
  server: { port: 5173, open: true },
  build: { outDir: 'dist', sourcemap: true },
});
