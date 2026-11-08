# 꺼진 등불의 땅 (가제) — 프로젝트 가이드

웹 브라우저에서 실행되는 소울라이크 액션 오픈월드 RPG.
목표 품질: 언리얼 엔진 5 수준의 분위기와 전투 손맛. 1차 목표는 "재의 평원" 버티컬 슬라이스
(약 1km² 지역, 일반 적 2~3종, 보스 1마리).

## 기술 스택
- Babylon.js 9.x (`@babylonjs/core`, `@babylonjs/loaders`, `@babylonjs/materials`) — 반드시 ES 모듈 개별 임포트 (트리 셰이킹)
- 물리: Havok (`@babylonjs/havok`, Physics V2 API)
- 언어/빌드: TypeScript (strict), Vite
- 렌더 백엔드: WebGPU 우선, 미지원 시 WebGL2 폴백
- 테스트: Vitest (sim/ 로직 위주)
- 에셋: glTF/GLB + KTX2 텍스처 + meshopt 압축

## 핵심 아키텍처 원칙
1. **로직과 렌더링 분리.** `src/sim/`은 Babylon.js를 절대 임포트하지 않는다. 순수 TypeScript로
   위치, 체력, 스태미나, 판정, AI 상태를 다룬다. 나중에 Node.js 서버로 옮겨 멀티플레이(2~4인 협동)에 재사용한다.
2. **고정 타임스텝.** 시뮬레이션은 60Hz 고정, 렌더링은 가변 프레임 + 보간.
3. **이벤트 기반 연결.** sim → render는 이벤트(피격, 사망, 공격 시작 등)로 전달한다.
4. **품질 프리셋.** 모든 무거운 기능(그림자 해상도, SSR, SSAO, 볼류메트릭, 식생 밀도)은
   Low/Medium/High/Ultra 프리셋에서 제어 가능해야 한다.

## 폴더 구조
```
src/
  core/       엔진 부트스트랩, 게임 루프, 입력(키보드/마우스/게임패드), 이벤트 버스
  sim/        순수 게임 로직 (엔티티, 전투, 스탯, AI) — Babylon 임포트 금지
  physics/    Havok 래퍼, 충돌 레이어, 캐릭터 컨트롤러, 셰이프캐스트
  render/     씬, 재질, 조명, 그림자, 후처리, 품질 프리셋
  anim/       애니메이션 상태 머신, 블렌딩, 루트 모션, 애니메이션 이벤트(노티파이)
  world/      지형 청크, 스트리밍, 식생(thin instances), LOD
  gameplay/   플레이어 컨트롤러, 3인칭/락온 카메라, 등불, 잔불(화폐)
  ui/         HUD (체력/스태미나/잔불), 메뉴
  assets/     에셋 로더, 매니페스트
tools/        에셋 최적화 스크립트 (gltf-transform)
public/assets/
```

## 렌더링 사양
- 재질: PBRMaterial 기본, 피부/천/지형은 Node Material
- 조명: HDR 환경맵(.env) IBL + 태양 1개 + 포인트 라이트(횃불, 등불)
- 그림자: 태양은 CascadedShadowGenerator (4 캐스케이드, PCSS), 원거리 캐스케이드는 몇 프레임마다 갱신
- 후처리 순서: SSAO → SSR → 볼류메트릭 라이트 → TAA → 모션 블러 → 블룸 → DOF → ACES 톤매핑 → LUT 그레이딩 → 비네팅/그레인
- 지역별로 LUT와 안개 색을 바꿀 수 있는 구조로 만든다
- 세계관상 태양이 꺼진 세계: 기본 조명은 어둡고, 플레이어의 등불(포인트 라이트)이 중요한 광원

## 물리 & 충돌
충돌 레이어 (Havok 필터 마스크, 정의: `src/physics/layers.ts`):
| 레이어 | 충돌 대상 |
|---|---|
| PLAYER | ENVIRONMENT, ENEMY, TRIGGER, PROJECTILE |
| ENEMY | ENVIRONMENT, PLAYER, ENEMY, PROJECTILE |
| ENVIRONMENT | TRIGGER를 제외한 모두 |
| TRIGGER | PLAYER (오버랩만) |
| PROJECTILE | ENVIRONMENT, PLAYER, ENEMY |

- Havok은 양쪽 마스크가 서로를 허용해야 충돌하므로 이 표는 반드시 대칭이어야 한다 (`tests/physics/layers.test.ts`가 검사).
- 물리는 게임 루프 고정 스텝(60Hz)에서 `PhysicsWorld.step()`으로만 진행한다 (렌더 프레임 자동 진행은 끔).
- F3: 충돌 셰이프 디버그 표시 (레이어별 색)

- 플레이어/적: 캡슐 캐릭터 컨트롤러
- 지형: 청크별 하이트필드 셰이프
- **전투 판정은 물리 바디를 쓰지 않는다.** 공격 애니메이션의 활성 프레임 동안 무기 궤적을 따라
  매 프레임 스윕 셰이프캐스트를 쏜다. 공격 1회당 히트 목록을 유지해 중복 타격을 막는다.
- 구르기 무적 프레임(i-frame)은 sim/에서 처리한다.
- 타격감: 히트스톱(2~4프레임), 카메라 셰이크, 피격 리액션

## 애니메이션
- Mixamo 기반 인간형 리그, AnimationGroup 가중치 블렌딩
- 이동 블렌드 트리: 대기/걷기/달리기/스프린트, 락온 시 8방향
- 상태 머신: Idle → Move → Attack(콤보) → Stagger → Roll → Death
- 애니메이션 이벤트로 판정 시작/끝, 효과음, 입력 버퍼 구간을 제어
- 공격/구르기는 루트 모션 추출 후 캐릭터 컨트롤러로 이동

## 지형 & 월드
- 256m 타일 청크, 플레이어 주변만 비동기 로드/해제
- 쿼드트리 LOD 하이트맵 + 스플랫맵 Node Material (트라이플래너, 4~8 레이어)
- 식생: thin instances, 원거리는 임포스터
- 청크 전환 시 디더 페이드로 팝인 완화

## 게임 시스템 (세계관 연동)
- **잔불:** 경험치이자 화폐. 사망 시 그 자리에 "꺼진 등"으로 드롭, 다음 사망 전에 회수 못 하면 소멸
- **등불:** 플레이어 허리의 실시간 광원. 켜고 끌 수 있음. 끄면 은신 가능하지만 시야가 크게 줄어듦
- **잔불 제단:** 체크포인트. 휴식 시 체력 회복, 적 리스폰

## 코딩 규칙
- `any` 금지, strict 모드 유지
- 매 프레임 할당 최소화 (Vector3 등은 재사용, `TmpVectors` 활용)
- 머티리얼은 가능하면 `freeze()`, 정적 메시는 `freezeWorldMatrix()`
- sim/ 로직에는 Vitest 단위 테스트 작성
- 기능 단위로 작게 커밋, 커밋 메시지는 한국어로
- 성능 목표: 중급 GPU, 1080p에서 60fps

## 에셋 규칙
- 라이선스가 확인된 에셋만 사용 (CC0 우선: Poly Haven, ambientCG)
- Hunyuan3D **공개 모델(오픈 웨이트, 커뮤니티 라이선스)로 직접 생성한** 결과물은 사용하지 않는다 (라이선스 지역에서 한국 제외 — 한국 출시 불가)
- 상업용 라이선스를 명시한 유료 서비스의 생성물(예: Krea.ai 유료 플랜의 Hunyuan3D 3.1 Pro)은 약관을 확인한 뒤 사용할 수 있다.
  credits.json에 서비스·플랜·약관 링크·확인일을 기록하고, 생성 당시의 구독 영수증과 약관 화면을 따로 보관한다 (약관은 바뀔 수 있다)
- 모든 GLB는 `tools/` 최적화 스크립트(KTX2 + meshopt)를 거친 뒤 `public/assets/`에 넣는다
- 에셋이 없을 때는 기본 도형(캡슐, 박스)으로 대체 구현하고 TODO로 표시한다

## 에셋 작업 절차

### 폴더 구조
```
raw/                              원본 (최적화 전, Git LFS 관리)
  models/<이름>/                  AI 생성 원본, 믹사모 리깅본 (<이름>_rigged.fbx)
  animations/<이름>/              믹사모 애니메이션 FBX ("Without Skin")
  textures/                       외부에서 받은 원본 텍스처
public/assets/                    게임에서 로드하는 최적화 결과물
  characters/<이름>.glb
  props/<이름>.glb
  textures/<재질명>/
  hdri/
  credits.json                    모든 외부 에셋의 출처/라이선스 기록
tools/
  blender/merge_animations.py     믹사모 애니메이션 병합
  blender/cleanup_model.py        AI 모델 정리 (데시메이트, LOD)
  fetch_polyhaven.mjs             Poly Haven API 다운로드
  fetch_ambientcg.mjs             ambientCG 다운로드
  optimize.mjs                    gltf-transform (KTX2 + meshopt)
```
- `.gitattributes`에 `*.fbx *.glb *.hdr *.exr *.png *.jpg *.ktx2`를 Git LFS로 등록한다.

### 외부 에셋 다운로드 (Poly Haven, ambientCG)
- Poly Haven은 공식 API(`api.polyhaven.com`)로 에셋 목록과 파일 URL을 조회한 뒤 다운로드한다.
- ambientCG는 2K JPG 세트를 기본으로 받는다. 노멀맵은 OpenGL 규격(NormalGL)을 받고, 뒤집혀 보이면 `invertNormalMapY`로 조정한다.
- 해상도 기준: 지면/일반 재질 2K, 클로즈업 히어로 재질만 4K, HDRI는 2K(개발용)~4K(최종).
- AO, Roughness, Metallic은 한 장의 ORM 텍스처(R=AO, G=Roughness, B=Metallic)로 패킹해 텍스처 수를 줄인다.
- 필요한 에셋만 받는다. 통째로 대량 다운로드하지 않는다.
- 받은 에셋은 반드시 `credits.json`에 기록한다: `{ "file", "source", "url", "author", "license" }`.
- 라이선스 기록이 없는 에셋은 커밋하지 않는다.

### AI 생성 모델 정리 (`cleanup_model.py`)
1. 트랜스폼 적용, 중복 정점 병합(Merge by Distance), 노멀 재계산
2. 원점을 발밑 중앙으로, 단위는 미터, 정면 방향 통일
3. 폴리곤 예산까지 데시메이트, LOD1(50%), LOD2(20%) 생성
4. 텍스처를 예산 해상도로 리사이즈

### 폴리곤/텍스처 예산
| 종류 | LOD0 삼각형 | 텍스처 |
|---|---|---|
| 플레이어 | 40k 이하 | 2K |
| 보스 | 60k 이하 | 2K~4K |
| 일반 적 | 25k 이하 | 2K |
| 소품 | 5k 이하 | 1K |

### 믹사모 애니메이션 병합 (`merge_animations.py`)
사용자가 할 일:
1. 모델을 믹사모에 올려 자동 리깅 → `raw/models/<이름>/<이름>_rigged.fbx`로 저장
2. 애니메이션을 "Without Skin", 30fps로 받아 `raw/animations/<이름>/`에 저장
3. 이동 계열(걷기, 달리기)은 "In Place" 체크, 공격/구르기는 체크 해제 (루트 모션 추출용)

Claude가 할 일:
1. `blender -b -P tools/blender/merge_animations.py -- --character <리깅본> --anims <폴더> --out <출력>` 형태로 헤드리스 실행
2. 리깅본을 불러오고 각 애니메이션 FBX의 액션을 캐릭터 아마추어로 옮긴다 (본 이름이 같은 믹사모 스켈레톤 전제)
3. FBX의 cm 단위를 m로 변환 (스케일 0.01)
4. 액션 이름을 아래 이름 규칙대로 바꾸고 NLA 트랙에 올려 모든 애니메이션이 GLB에 포함되게 한다
5. GLB로 내보낸 뒤 `optimize.mjs`로 최적화
6. 결과 GLB의 애니메이션 목록과 길이(초)를 출력해 검증하고, 누락된 필수 애니메이션을 보고한다
- 루트 모션: 믹사모 스켈레톤은 루트 본이 없으므로 Hips 본의 수평(XZ) 이동을 루트 모션으로 추출해 캐릭터 컨트롤러에 전달한다.

### 애니메이션 이름 규칙 (snake_case)
| 분류 | 이름 |
|---|---|
| 기본 | `idle`, `guard`, `drink`(회복) |
| 이동 | `walk_f`, `walk_b`, `walk_l`, `walk_r`, `run_f`, `sprint` |
| 회피 | `roll_f`, `roll_b`, `backstep` |
| 공격 | `attack_light_1`, `attack_light_2`, `attack_light_3`, `attack_heavy`, `attack_run` |
| 피격 | `hit_front`, `hit_back`, `stagger`, `parry` |
| 사망 | `death` |
- 코드는 이 이름으로만 애니메이션을 참조한다. 없는 애니메이션은 `idle`로 대체하고 콘솔 경고를 띄운다.
- 믹사모 원본 파일명과 이름 규칙의 매핑은 `raw/animations/<이름>/mapping.json`에 기록한다. 매핑이 없으면 Claude가 파일명을 보고 추정해 작성하고 사용자에게 확인받는다.

### 애니메이션 이벤트
- `src/anim/events/<이름>.json`에 애니메이션별 프레임 이벤트를 정의한다:
  `hit_start`, `hit_end`, `iframe_start`, `iframe_end`, `input_buffer_start`, `cancel_window`, `sfx:<이름>`
- 처음에는 Claude가 애니메이션 길이를 보고 추정값을 넣고, 사용자가 테스트하며 조정한다.

## 클라우드 환경 (참고)
- 네트워크: Custom + 기본 패키지 매니저 목록 포함
- 추가 허용 도메인: `polyhaven.com`, `api.polyhaven.com`, `dl.polyhaven.org`, `ambientcg.com`, `acg-download.struffelproductions.com`, `assets.babylonjs.com`, `download.blender.org`
- 설치 스크립트: `npm install`, `apt-get install -y blender`
- 다운로드가 "Host not in allowlist"로 막히면 작업을 멈추고, 추가해야 할 도메인을 사용자에게 알린다.
- Claude는 게임 화면을 볼 수 없으므로, 시각/조작감 관련 작업 후에는 사용자가 확인할 항목을 목록으로 남긴다.
