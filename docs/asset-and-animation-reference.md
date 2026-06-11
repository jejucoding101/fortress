# 에셋 및 애니메이션 자료 정리

작성일: 2026-06-10

## 메모

이 문서는 현재 작업공간에 남아 있는 자료를 기준으로 정리한 것입니다.
이전 대화 중 웹 검색으로 찾았던 외부 링크 목록은 현재 로컬 파일 안에 따로 남아 있지 않아, 아래에는 실제로 확인 가능한 자산과 작업 결과만 기록합니다.

## 3D 자료 상태

- 현재 `fortress2-clone` 작업공간 안에는 `.glb`, `.gltf`, `.fbx`, `.obj` 같은 3D 모델 파일이 없습니다.
- 현재 확인 가능한 탱크 관련 자료는 모두 2D 컨셉 이미지, 스프라이트 시트, 레이어 분리 PNG입니다.
- 따라서 지금 기준으로는 `3D 에셋 확보` 단계가 아니라 `2D 포트리스 스타일 탱크 자산 정리 및 애니메이션 준비` 단계로 보는 것이 맞습니다.

## 현재 확보한 탱크 자산

### 1. 컨셉 이미지

- [tank_rust_red_top_right.png](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/public/assets/tanks/concepts/tank_rust_red_top_right.png)
  - 러스트 레드 탱크 컨셉 원본
  - 3/4 시점
  - 레이어 분리 작업의 시각적 참고 자료로 사용

- [tank_olive_top_left.png](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/public/assets/tanks/concepts/tank_olive_top_left.png)
- [tank_steel_blue_bottom_left.png](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/public/assets/tanks/concepts/tank_steel_blue_bottom_left.png)
- [tank_yellow_bottom_right.png](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/public/assets/tanks/concepts/tank_yellow_bottom_right.png)
  - 색상/형태 변형 참고용 컨셉 이미지
  - 현재 게임에는 직접 투입되지 않음

### 2. 기존 2D 스프라이트 시트

- [red_tank_idle_4x4_transparent.png](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/public/assets/tanks/red-idle/red_tank_idle_4x4_transparent.png)
  - 빨간 탱크 idle 시트
  - 개별 프레임 `red_idle_01.png` ~ `red_idle_16.png` 존재

- [red_tank_fire_4x4_transparent.png](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/public/assets/tanks/red-fire/red_tank_fire_4x4_transparent.png)
  - 빨간 탱크 fire 시트
  - 개별 프레임 `red_fire_01.png` ~ `red_fire_16.png` 존재

### 3. 최근 제작한 레이어 분리 자산

- [body_side.png](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/public/assets/tanks/rust-red-layers/body_side.png)
  - 측면 바디 레이어
  - 실제 투명 PNG로 정리 완료
  - 포탑 장착부가 비어 있어 포탑 회전 테스트에 적합

- [turret_side.png](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/public/assets/tanks/rust-red-layers/turret_side.png)
  - 초기 측면 포탑 레이어
  - 하부가 평평한 버전
  - 현재는 대체안으로 보관

- [turret_side_round.png](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/public/assets/tanks/rust-red-layers/turret_side_round.png)
  - 둥근 하부를 가진 포탑 레이어
  - 각도 조절 시 밑면이 뜨는 어색함을 줄이기 위해 만든 개선안
  - 실제 투명 PNG로 정리 완료
  - 현재 포탑 테스트용 주 버전

## 애니메이션 자료 및 실험 도구

### 1. 조합 뷰어

- [tank-layer-preview.html](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/public/tools/tank-layer-preview.html)
  - 몸통 + 포탑 레이어를 겹쳐보는 조합 뷰어
  - 포탑 위치, 포탑 스케일, 피벗 위치를 슬라이더로 조정 가능
  - 포탑 스윕, 발사 반동, 눈 placeholder 애니메이션 테스트 가능
  - 기준점 표시 기능 포함
  - 현재 기준:
    - 포탑 피벗 위치는 파란색 `+`
    - 포탑 위치 기준점은 오렌지색 `+`

### 2. 애니메이션 구현용 재료

- 기존 스프라이트 시트 기반 애니메이션
  - `idle`
  - `fire`

- 레이어 기반 애니메이션 실험
  - 포탑 상하 회전
  - 발사 반동
  - 눈 레이어 교체 또는 눈 placeholder 기반 시선/깜빡임

## 관련 문서

- [multiplayer-implementation-plan.md](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/docs/multiplayer-implementation-plan.md)
  - 멀티플레이 구조 문서

- [tank-animation-asset-pipeline-doodle.png](/abs/path/c:/Users/CODING101%201호기/Desktop/vibe101_강혁재/fortress2-clone/docs/tank-animation-asset-pipeline-doodle.png)
  - 탱크 애니메이션/자산 관련 스케치 자료

## 다음 정리 권장

- 실제 외부 검색 링크를 다시 찾게 되면 `에셋 출처`, `라이선스`, `용도`, `다운로드 상태` 열을 가진 표 형태로 이 문서에 추가
- `눈 레이어`가 확정되면 `body / eyes / turret` 3분리 구조 기준으로 파츠 파일명을 고정
- `turret_side_round.png` 기준으로 Phaser 탱크 렌더러의 기본 피벗 값을 코드에 반영
