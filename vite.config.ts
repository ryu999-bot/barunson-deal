import { defineConfig } from 'vite';

// 바른라운지 업체 관리자 — 로컬 개발: `npm run dev` (localhost, HMR)
// 배포 빌드: `npm run build` → dist/ (정적 번들)
// 컨테이너 실행: `npm start` (build 후 preview 서버, PORT 환경변수 지원)
export default defineConfig({
  base: './',
  server: { port: 5173, open: true },
  preview: {
    host: true,                                   // 0.0.0.0 바인딩 (컨테이너 외부 접근)
    port: Number(process.env.PORT) || 4173,       // docker-manager가 주입하는 PORT 우선
    allowedHosts: true,                           // 프록시 도메인 허용
  },
  build: { outDir: 'dist', sourcemap: true },
});
