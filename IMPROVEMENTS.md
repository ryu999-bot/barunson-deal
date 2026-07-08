# IMPROVEMENTS — 바른라운지 업체 관리자

개선·보완 예정 사항. 상세 로드맵은 [docs/기능_PRD.md](docs/기능_PRD.md) §7, 기술 배경은 [docs/기술_PRD.md](docs/기술_PRD.md) 참조.

## 단기 (M0 파일럿 — 실서비스 연동)

- [ ] `src/api.ts` 목 데이터 → 바른손카드 실 API 교체 (쿠폰 발급·조회·사용처리, 실시간 연동)
- [ ] `src/auth.ts` localStorage 목 → 서버 인증(JWT) 교체, 비밀번호 해시 저장
- [ ] 사용처리 API 멱등키·사업자 스코프 서버 검증
- [ ] SMS/알림톡 게이트웨이 연동 (현재 콘솔 목)
- [ ] 데모 기준일(`BASE_DATE`) → 실시간 전환
- [ ] 환불 이벤트(웹훅) 수신 → 쿠폰 상태 동기화

## 중기 (M1 — donald-duck 스택 정렬, ~3주)

- [ ] 프론트엔드: Vite 바닐라 TS → Next.js 15 + Tailwind v4 이식
- [ ] 백엔드: NestJS 11 + Prisma(PostgreSQL) 스캐폴딩, `domain.ts` 정산 로직 서버 이전
- [ ] 바른손카드 MSSQL 어댑터 격리 (Port & Adapter)
- [ ] 바른 ERP 정산 데이터 연동 (지급·세금계산서)

## 장기 (M2 — donald-duck 플랫폼 흡수)

- [ ] `voucher`·`settlement` 도메인 편입
- [ ] 정산 엔진 복수 모델(config) 지원 — 오픈마켓 수수료형과 사용 기준 정산 공존

## 미결 정책

- [ ] 다회권 중도해지 위약금 요율 (법무 검토)
- [ ] 계약 주체 법인명 통일 (바른컴퍼니 vs 바른손카드)
