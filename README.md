# 📺 JJKC YouTube Algorithm Project

내 유튜브 알고리즘(시청·구독·좋아요)을 분석해 공유하고, 다른 사람의 알고리즘으로
탐색하며, **한국 채널을 클러스터링해 내 취향에 맞는 채널을 추천**하는 서비스입니다.
https://ytalgoshare.vercel.app/

## 📂 프로젝트 구조

| 폴더 | 설명 |
|---|---|
| **`jhs/`** | **메인 풀스택 앱** (Next.js 15 + Prisma + NextAuth + YouTube Data API). 현재 모든 기능이 여기 구현됨. |
| `report/` | 주차별 기획·리포트 (`weekNN/(이름)/`). 최신 계획: `report/week12/(이름)/channel_analyze_plan.md` |
| `prototype/` | 초기 mock 기반 프로토타입 (참고용) |
| `jimmy/` | 키워드 검색 PoC 스크립트 |

## 🚀 실행

```bash
cd jhs
npm install
npm run dev          # http://localhost:3000
```

`.env`(루트의 `.env` 자동 인식): `DATABASE_URL`, `GOOGLE_CLIENT_ID/SECRET`,
`AUTH_SECRET`, `NEXTAUTH_URL` 필요. 자세한 설정·데이터 흐름은 [`jhs/README.md`](jhs/README.md) 참고.

---

## ✅ 진행 상황

### Phase 1–3 — 알고리즘 공유 (완료, `jhs/`)
- Google/YouTube OAuth 로그인, 구독·좋아요·플레이리스트·활동 동기화
- 카테고리 분포 / 대표 채널 / 키워드 / 지표(다양성·Shorts비율·니치도 등) 프로필
- 공개/비공개 토글, 타인 알고리즘 피드(`/profile/[id]`), 비교(`/compare`), 닮은 사용자 추천

### Phase 4 — 채널 클러스터링 & 추천 (이번 구현, `report/week12/(이름)/channel_analyze_plan.md`)
한국 채널(구독자 10만+)을 수집·벡터화·클러스터링해 사용자 알고리즘에 맞는 채널을 추천.
**핵심: 채널을 사용자 프로필과 같은 카테고리 벡터 공간에 올려 기존 `profileSimilarity` 를 재사용 → 추천 서빙 쿼터 0u.**

| 구성 | 위치 |
|---|---|
| DB 모델 | `Channel` / `ChannelCluster` / `CollectionRun` + `AlgoProfile.subscribedChannelIds` (`jhs/prisma/schema.prisma`) |
| 수집 (재개 가능 BFS) | `jhs/scripts/channels-collect.ts` — API key / DB OAuth 토큰 / `--mock` 3경로 |
| 피처 벡터화 + 한국 채널 판정 | `jhs/lib/channel-features.ts` (+ 공용 헬퍼 `lib/category-utils.ts`) |
| 클러스터링 (순수 TS k-means++ + 실루엣) | `jhs/lib/kmeans.ts` · `jhs/scripts/channels-cluster.ts` |
| 추천 (클러스터 배정 + 채널 랭킹) | `jhs/lib/channel-recommender.ts` |
| API / UI | `/api/channels/recommend`, `/api/clusters`, `/api/clusters/[id]`, `/discover` 페이지 |

체험:
```bash
cd jhs
# 쿼터 0 으로 즉시 체험 (합성 데이터)
npm run channels:collect -- --mock 300
npm run channels:cluster
npm run dev      # 로그인 후 /discover

# 실제 수집 — .env 에 YOUTUBE_API_KEY 가 있거나 앱에서 Google 로그인했으면 동작
npm run channels:collect       # 재개 가능, --no-search / --no-uploads 로 쿼터 절감
npm run channels:cluster
```

검증: 타입체크·프로덕션 빌드 통과, mock 300채널 → 실루엣이 k=8 선택(8개 아키타입 복원),
추천 의미 확인(Music 취향→음악 클러스터/채널, Tech 취향→테크 클러스터/채널).

---

## 🪜 다음 해야 할 Step

1. **실제 채널 수집 실행** — 현재 dev.db 엔 검증용 mock 300개만 있음. `YOUTUBE_API_KEY` 발급(권장) 또는 Google 로그인 후 `channels:collect` → `channels:cluster` 로 1,000개 적재. (실제 수집 ≈ 3,000–5,000u, 며칠 분산 가능)
2. **한국어 토큰화 개선** — 키워드가 공백/기호 토큰화 수준. 형태소 분석(mecab-ko 등) 도입.
3. **클러스터 2D 맵 시각화** — 현재 배정 카드 + 나 vs 중심 radar. PCA/t-SNE 산점도로 "한국 유튜브 지도 + 내 위치" 추가.
4. **수집 비용 튜닝** — `search.list` 의존 축소, snowball 비중↑, 업로드 보강 on/off(`--no-uploads`) 트레이드오프 정리.
5. **추천 캐시 무효화 정교화** — 현재 TTL 기반. `lastSyncedAt` + 클러스터 버전 키로 sync/재클러스터 시 자동 무효화.
6. **주간 갱신 자동화** — 채널 메타는 느리게 변함 → cron/`schedule` 로 주 1회 재수집·재클러스터.
7. **마이그레이션화 & Postgres 전환** — 스키마는 `prisma db push` 로 반영됨(마이그레이션 미생성). `migrate dev` 로 이력화 + Neon 전환.
8. **week12 메커니즘 리포트** — week10 리포트 형식으로 채널 파이프라인 분해 문서 작성(`report/week12/(이름)/`).

---

## 🛠 기술 스택

Next.js 15 (App Router, RSC) · React 19 · Prisma + SQLite(→Postgres) · NextAuth v5(Google OAuth) ·
YouTube Data API v3 · Upstash Redis(선택) · recharts · Tailwind CSS
