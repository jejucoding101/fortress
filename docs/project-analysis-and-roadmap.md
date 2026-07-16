# 포트리스 듀얼 프로젝트 분석 및 구현 로드맵

작성일: 2026-07-14

## 1. 프로젝트 개요

이 작업공간(`fortress2-clone`)은 **포트리스 듀얼**이라는 이름의 2D 턴제 포격 게임 프로토타입입니다.
README는 "Phaser 3, TypeScript, Vite, Socket.IO로 만든 2D 턴제 포격 게임 프로토타입"으로 정의합니다.

핵심 컨셉은 좌/우 양 진영에 배치된 탱크들이 번갈아 가며 각도와 파워를 조절해 포탄을 쏘고, 지형을 파괴하며 적 탱크의 HP를 0으로 만드는 팀전 게임입니다.

기본 게임플레이는 다음과 같은 흐름입니다.

1. 한 명 이상의 사람 플레이어가 로비에서 방을 만들거나 입장합니다.
2. 방장은 컴퓨터 플레이어를 추가할 수 있고, 모든 슬롯은 A(왼쪽)/B(오른쪽) 팀으로 나뉩니다.
3. 사람 플레이어는 한 번의 턴에 자신의 탱크를 좌우로 이동하고, 포신 각도를 조절하고, 스페이스바를 길게 눌러 파워를 충전한 다음 떼면 발사합니다.
4. 서버는 포탄의 궤적, 바람의 영향, 지형 충돌, 데미지, 승패 판정을 모두 책임집니다.
5. 20초 안에 발사하지 않으면 턴이 자동으로 넘어갑니다.

## 2. 기술 스택

- **클라이언트**: Phaser 3, TypeScript, Vite(포트 5173)
- **서버**: Node.js + Express + Socket.IO(포트 3000), TypeScript(`tsx`로 실행)
- **번들/타입 검증**: Vite + TypeScript strict 모드
- **개발 스크립트**:
  - `npm run dev`: 서버와 Vite 클라이언트를 `concurrently`로 동시 실행
  - `npm run dev:client` / `npm run dev:server`: 각각 단독 실행
  - `npm run build`: TypeScript 검사 후 Vite 번들 생성
  - `start.bat`: 3000/5173 포트 점유 프로세스를 정리한 뒤 `npm run dev` 실행

## 3. 디렉터리 구조

```txt
fortress2-clone/
├── README.md                 # 실행/조작/구현된 기능 안내
├── lessons.md                # PowerShell 사용 회피 등 학습 메모
├── package.json              # 의존성/스크립트
├── tsconfig.json             # TypeScript strict 설정
├── index.html                # DOM(로비, HUD, 게임 메뉴, 탱크 선택 등)
├── src/
│   ├── main.ts               # Phaser Scene, 로비/메뉴/소켓/탱크 선택 UI
│   ├── styles.css            # DOM 스타일
│   └── shared/               # 클라이언트와 서버가 같이 사용하는 코드
│       ├── constants.ts      # 뷰포트/중력/HP/파워/턴 시간 등 상수
│       ├── gameData.ts       # 탱크/무기/아이템 정의와 헬퍼
│       ├── terrain.ts        # 결정적 지형 생성/충돌/슬로프 계산
│       └── types.ts          # GameState, 이벤트 타입 등 공용 타입
├── server/
│   ├── index.ts              # Express + Socket.IO, dev용 이미지 업로드 엔드포인트
│   ├── rooms.ts              # RoomManager (방 ID 생성/조회)
│   └── gameSession.ts        # GameSession (게임 상태/물리/AI/턴 타이머)
├── public/
│   ├── assets/
│   │   ├── projectiles/      # 무기별 발사 시트 PNG(각 5프레임)
│   │   └── tanks/            # 탱크 idle 시트, simple 썸네일, 컨셉/레이어 자료
│   └── tools/                # 로컬 HTML 에디터(미사일 프레임, 탱크 레이어)
├── docs/
│   ├── multiplayer-implementation-plan.md
│   ├── development-shell-guidelines.md
│   ├── asset-and-animation-reference.md
│   └── tank-animation-asset-pipeline-doodle.png
└── scripts/
    ├── extract_tank_debug_frames.py
    ├── generate_idle_sheets.py
    └── unicode-path.mjs           # 한글 경로 안전 접근용 Node 헬퍼
```

## 4. 구현된 핵심 기능 (현재 상태)

### 4.1 멀티플레이 / 로비
- Socket.IO 기반 방 만들기/입장 (4글자 코드)
- 사람/컴퓨터를 A/B 팀으로 분리
- 방장만 컴퓨터 추가/삭제/팀/탱크 변경 가능
- 사람 플레이어는 한 슬롯 자기 자신의 팀만 변경 가능
- 인원/팀 구성 검증 후 게임 시작

### 4.2 게임 진행
- 서버 권위 턴제 전투(상태는 항상 서버가 브로드캐스트)
- 호스트가 R 키로 재시작 가능
- 사람 플레이어 입장에서 키보드만으로 조작 (`Left/Right`, `Up/Down`, `Space` 홀드/릴리스)
- 파워 트랙의 마커를 클릭/드래그해 목표 파워 사전 설정
- 20초 턴 타이머(클라이언트 HUD에 시계 표시)
- 카메라 자동 추적(포탄 비행 중) + 마우스 가장자리 호버로 수동 스크롤

### 4.3 물리/지형
- 결정적 지형(`terrainSeed` 기반 노이즈 + 섬/계단/계곡)
- 12px 간격으로 다각형 지형 생성, Canvas2D 텍스처에 그라데이션 토양 + 섬 + 크레이터 적용
- 포탄은 서버에서 fixed timestep(`SHOT_STEP_MS = 16`)으로 적분
- 충돌은 `isSolidTerrainAt` + `terrainHoles` 배열로 판정
- 폭발 시 원형 크레이터 + 카메라 셰이크 + 화이트 섬광/충격파 트윈
- HP/MP(체력)바, 다이나믹 슬로프에 맞춘 탱크 회전

### 4.4 전투/AI
- 7개 슬롯 지원, 1:1부터 팀전까지 자유 구성
- 컴퓨터 AI는 적 우선 타깃 선택 → 시뮬레이션 브루트 포스(각도/파워 그리드) → 잡음 추가 후 발사
- 발사 결과 메모리(`ShotMemory[]`)를 다음 발사 보정에 활용
- 점수 높으면 사전 미세 위치 조정도 시도
- HP 0 또는 추락(지지면 없음) 시 다음 턴부터 제외
- 한 팀만 살아남으면 `phase = "gameover"`로 종료

### 4.5 자산/에디터
- 7종 탱크(`tank1~tank6`, `tank8`) + 7종 무기(레이디버그 밤, 버블 토피도, 씨앗 포드, 드릴 로켓, 플라즈마 펄, 레스큐 캡슐, 아이스 크리스탈)
- 각 무기는 5프레임 PNG 시트와 origin 지정값을 가짐
- `public/tools/projectile-animation-preview.html`은 로컬 브라우저에서 무기별 시트를 미리 보고, 프레임별 오프셋/스케일을 수정한 뒤 `/dev/projectile-frames` 엔드포인트로 저장할 수 있는 프레임 에디터 (적용 시 `gameData.ts`의 `PROJECTILE_ASSET_VERSION`도 자동 갱신)
- `public/tools/tank-layer-preview.html`은 본체/포탑 레이어 합성 테스트 도구
- 탱크 idle 시트는 8프레임 가로 스트립, 클라이언트가 마스크 알고리즘(외곽 flood-fill + 슬라이딩 anchor)으로 배경 제거 및 트랙 기준 정렬을 적용한 후 Phaser 애니메이션으로 사용

### 4.6 보안/검증
- 서버 `canAct()` 가 현재 턴의 사람 플레이어 + 살아있음 + 페이즈=aim + 낙하 중 아님을 모두 검사
- 발사 시 `power`를 `MIN_POWER/MAX_POWER`로 클램프
- `move`/`setAngle`도 서버에서 `clampPlayerAngle`, `tryMovePlayer`로 검증
- 호스트 권한은 `state.hostSocketId`와 비교하여 강제

## 5. 의도적으로 아직 단순화되어 있는 부분

다음은 코드와 문서에서 **미구현 또는 최소 구현**으로 드러나는 부분입니다. 추가 구현 후보 작업의 출발점입니다.

| 영역 | 현재 상태 | 보완 아이디어 |
| --- | --- | --- |
| 아이템 사용 | 타입은 정의(`ItemStack`, `ItemEffect`), 인벤토리 슬롯(4)은 항상 `EMPTY_ITEM_ID` | 실제 아이템 효과(수리/실드/파워부스트/엑스트라샷) 부여, 인게임 사용 |
| 다양한 무기 효과 | 모든 무기가 동일한 `damageRadius/maxDamage/minDamage/windInfluence` | 무기별 고유 효과(관통, 범위 증가, 슬로우, 클러스터 등) |
| 전장 환경 | 단일 지형, 단일 시간대/하늘 | 사막/설산/도시 맵, 주/야간, 비/안개 |
| 사운드/이펙트 | 비주얼 이펙트만 존재 | 발사/폭발/턴 시작 SFX, UI 효과음 |
| 난이도/통계 | `easy/normal/hard` 3단계만 존재, HUD 노출은 없음 | 난이도 선택 UI, 승률/명중률 통계 |
| 관전/재접속 | 연결 끊김 시 `connected=false`로 표시만 | 리커넥트 토큰, 관전자 슬롯, 인터미션 |
| 3인 이상 대전 | 7슬롯/4팀까지 코드상 가능하나 UI는 2열(A/B) | C/D 팀 슬롯 노출, 팀 색상 일관화 |
| 마무리 연출 | 승리 메시지와 메뉴만 노출 | 점수 집계, 플레이어별 하이라이트 리플레이 |
| 테스트 자동화 | 단위/E2E 테스트 부재 | 순수 함수(`terrain.ts`, 시뮬레이션) 유닛 테스트, 헤드리스 회귀 |
| 성능 최적화 | 매 상태마다 정적 변수 새로 그림 | 크레이터 누적 시 dirty-rect 갱신, 디더링 |
| 접근성/모바일 | 키보드/데스크톱만 지원 | 가상 조이스틱, 터치 조준, 버튼 UI |
| 국제화 | 한국어 전용 | 문자열 리소스 분리(i18n), 다국어 |
| 운영 도구 | 시작 스크립트, 일부 로컬 에디터만 | 디버그 HUD, P2P/모의 서버, 리플레이 저장/불러오기 |

## 6. 추가 구현 추천 작업

아래는 우선순위/범위별로 묶은 후보 작업입니다. 다른 도메인 변경을 최소화하도록 작업 단위를 잘게 쪼개 두었습니다.

### 6.1 단기 (1~2개 작업 단위)
- **아이템 사용 루프 연결**
  - 서버: `useItem(playerId, slotIndex)` 이벤트 추가, `ItemStack.quantity` 감소, 효과 적용(예: repair +HP, shield +임시 데미지 무효, powerBoost +다음 발사 파워 보정, extraShot +이번 턴 추가 발사)
  - 클라이언트: 전투 콘솔의 슬롯 1~4 버튼 클릭 → 서버에 요청 → 효과 만료까지 HUD에 표시
  - 데이터: `ITEM_DEFINITIONS`에 신규 아이템(`repair-kit`, `shield-cell`, `power-cell`, `extra-shot`) 추가
- **난이도 선택 UI**
  - 컴퓨터 추가 시 easy/normal/hard 선택 다이얼로그, 서버는 `addComputerPlayer`의 인자로 받은 난이도를 그대로 저장
  - HUD에는 비표시 유지(스텔스), AI 행동 로그만 디버그 모드에서 노출

### 6.2 중기 (아키텍처 소규모 변경 포함)
- **다양한 지형/시간대 프리셋**
  - `shared/terrain.ts`에 `getTerrainPresets(seed)`를 도입하여 평지/계단/협곡/도시 중 선택
  - 게임 시작 시 호스트가 프리셋을 선택해 `terrainSeed`/`preset`으로 broadcast
- **전장 카메라/줌 개선**
  - Phaser 카메라에 미니맵 추가(간단한 Rectangle + 정적 렌더)
  - `setZoom`을 키보드 단축키(`Z/X`) 또는 휠로 허용
- **리플레이/하이라이트**
  - 발사 종료 시 `lastShot` 정보를 `state.lastShot`에 저장
  - 클라이언트에서 발사 궤적을 임시 그래픽으로 3초간 페이드

### 6.3 장기 (구조 변경 포함)
- **관전자 모드와 재접속 복구**
  - `players` 배열에 `kind: "spectator"` 추가, 턴 흐름에는 영향 X
  - `localStorage`에 `roomId + playerId + token` 저장 → 재접속 시 동일 슬롯 복구
- **3팀 이상 대전 UI**
  - `createTeamColumn`을 팀 ID 배열 기반으로 일반화, A/B/C/D 각각 색/라벨 부여
  - 슬롯 수 제한(`MAX_PLAYERS=7`)을 시각화(예: 사용 중/빈 슬롯)
- **아이템/스킬 이펙트 + 사운드**
  - Phaser WebAudio 또는 HTMLAudio로 발사/폭발/턴 시작 SFX
  - 아이템 사용 시 화면 효과(쉴드 후광, 회복 파티클)
- **테스트 자동화**
  - `vitest` 도입, `terrain.ts`/`findBestShot` 시뮬레이션 등 순수 함수 유닛 테스트
  - Socket.IO 단대단 테스트(헤드리스 Phaser는 어렵기 때문에 `stateSync` 스냅샷 비교 방식 권장)
- **모바일/터치 지원**
  - 가상 D-패드 + 슬라이더를 DOM 레이어로 추가
  - Phaser Scene 이벤트와 동기화

## 7. 작업 시 알아둘 운영 메모

- **셸**: PowerShell 사용을 금지합니다(한국어 인코딩 문제). `start.bat` 또는 일반 `cmd.exe`를 사용하세요. 한글 경로 접근이 필요하면 `node scripts/unicode-path.mjs` 헬퍼를 씁니다.
- **자산 변경 워크플로우**:
  - 미사일 프레임 수정 → `public/tools/projectile-animation-preview.html`로 열고 `Apply` 클릭. 서버가 PNG를 덮어쓰고 `gameData.ts`의 `PROJECTILE_ASSET_VERSION`을 갱신합니다.
  - 탱크 컨셉 → `scripts/generate_idle_sheets.py` / `extract_tank_debug_frames.py` 사용 가능.
- **타입 안정성**: `tsconfig.json`이 strict 모드이며 `src`만 타입 검사합니다. 서버 코드도 같은 타입을 사용하므로 동기화 변경 시 두 곳 모두 업데이트해야 합니다.
- **상수**: 물리/게임 밸런스 관련 숫자는 모두 `src/shared/constants.ts`에 모여 있습니다. 새 무기/탱크를 추가하면 `src/shared/gameData.ts`의 `PLAYABLE_TANK_IDS`/`WEAPON_DEFINITIONS`도 함께 수정해야 합니다.

## 8. 다음 단계 제안

가장 빠르게 가치를 확인할 수 있는 후보는 다음 두 가지입니다.

1. **아이템 사용 루프 연결**: 기존 인벤토리/HUD 슬롯을 그대로 활용하므로 UI 변경이 작고, 게임 템포에 즉시 변화가 생깁니다.
2. **다양한 지형 프리셋 + 사운드**: 게임의 시각/청각 다양성을 넓히면서 큰 리팩터링 없이 효과를 확인할 수 있습니다.

이 두 작업 중에서 우선 진행할 항목을 알려 주시면 구체적인 변경 계획과 작업 단위 분해로 이어가겠습니다.
