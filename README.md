# HandDock

HandDock는 카메라와 손 제스처를 중심으로 여러 작업물을 하나의 로컬 허브에서 여는 프로젝트다.  
목표는 마우스와 키보드 의존을 줄이고, 손의 위치와 제스처만으로 작업물을 탐색하고 실행하는 것이다.

## 현재 구현된 핵심 구조

- `apps/hub`
  - 실제 진입점이 되는 로컬 허브 앱
  - 로봇 랜딩 화면, 브레인 메뉴, 개별 작업물 페이지를 포함
- `apps/hand-tracking-lab`
  - 손 추적과 제스처 인식을 빠르게 시험하는 실험용 공간
- `packages/hand-tracking`
  - 손 랜드마크 정규화, 제스처 판별, 좌표 보정 등에 쓰일 공용 로직 자리
- `packages/spline-adapters`
  - Spline 커뮤니티 코드와 로컬 수정 내용을 분리해 관리할 자리
- `packages/ui`
  - 허브와 작업물에서 공통으로 쓸 UI 조각과 제스처 피드백용 컴포넌트 자리

## 현재 허브에서 가능한 일

- 첫 화면에서 손 커서로 메인 메뉴를 연다.
- 메인 메뉴에서 프로젝트 구체를 가리키고 제스처로 작업물로 들어간다.
- 현재는 다음 네 작업물이 연결되어 있다.
  - `Solar Orrery`
  - `NBV Robotics Lab`
  - `WallCL`
  - `LCL`

## 현재 제스처 기반 동작 개요

- 허브
  - 오른손 검지 위치를 커서처럼 사용
  - 왼손 제스처로 메뉴 진입 및 프로젝트 실행
  - 우하단 `Exit` 버튼 위에서 왼손 주먹을 유지하면 메인으로 복귀
- Solar Orrery
  - 태양계 공전 시뮬레이션
  - 행성 포커스, 블랙홀 오버레이, 메뉴 복귀 제스처 포함
- NBV Robotics Lab
  - 오른손 `pinch`: 물체 grasp 및 이동
  - 왼손 `pinch`: 특정 물체에 대한 정밀 스캔 우선 지시
  - 우상단 속도 바는 오른손 포인터와 `pinch`로 조절
  - 사용자가 멈춰 있으면 NBV, pose estimation, grasp planning, basket 이송이 자동 수행
- WallCL
  - 벽면 클라이밍 gait를 자동 재생
  - 듀얼 서보 암, 자석 접점, 센터 프레임으로 구성한 예상 하드웨어 디자인을 함께 표시
  - 우하단 `Exit` 버튼을 통해 허브로 복귀
- LCL
  - 원본 이미지와 빛 노이즈 증강 이미지를 positive pair로 묶는 contrastive learning 과정을 자동 재생
  - 학습이 진행될수록 latent embedding 정렬, similarity 상승, lane / obstacle detection 강건성이 함께 갱신됨
  - 우하단 `Exit` 버튼을 통해 허브로 복귀

## NBV Robotics Lab 설명

이 작업물은 연속된 single-view 기반 3D semantic segmentation을 직관적으로 보여주기 위한 브라우저 시뮬레이션이다.

- occlusion이 있는 작업대 환경을 만든다.
- 후보 view들 중 어느 방향이 information gain이 큰지 계산한다.
- 각 물체의 uncertainty가 시간이 지나며 어떻게 줄어드는지 추적한다.
- 물체별 confidence를 화면 위 물체 라벨에 직접 표시한다.
- 충분한 관측이 쌓이면 two-finger gripper 기준으로 grasp 가능성을 평가한다.
- 모든 물체에 대한 grasp planning이 끝나면 로봇팔이 자동으로 grasp를 수행한다.

## WallCL 설명

`WallCL`은 벽면을 오르는 로봇의 접촉 순서와 바디 이동 방식을 브라우저에서 빠르게 검토하기 위한 시뮬레이션이다.

- 참고 레포의 `climb.js`에서 사용한 2-arm kinematics를 SVG 기반으로 재구성했다.
- 벽면 접점, 몸체 스윙, 앵커 복귀의 세 단계를 자동으로 반복한다.
- Arduino 코드에 나타나는 좌우 서보와 `magnetL / magnetR / magnetC` 구조를 바탕으로 예상 하드웨어 구성을 도식화했다.
- 실기 사진 자산이 없어도, 로봇의 예상 프레임 구조와 제어 스택을 한 화면에서 이해할 수 있도록 정리했다.

## LCL 설명

`LCL`은 contrastive learning을 이용해 빛 반사와 센서 노이즈에 강건한 representation을 만드는 과정을 시각화한 프로젝트다.

- 원본 주행 장면과 glare / light-noise 증강 장면을 positive pair로 묶는다.
- latent embedding 공간에서 positive는 가까워지고 negative는 멀어지는 과정을 보여준다.
- 학습이 진행되면 차선과 장애물 검출 confidence가 함께 올라가도록 시각적으로 연결했다.
- 별도 이미지 파일 없이 SVG와 DOM만으로 학습 장면과 주행 추론 장면을 재구성했다.

## 실행 방법

루트에서 다음 명령을 사용한다.

```bash
npm install
npm run dev:hub
```

기본 개발 서버는 `http://localhost:3000`이다.

정적 빌드는 다음과 같다.

```bash
npm run build --workspace @handdock/hub
```

## 프로젝트 방향

이 저장소는 완성형 제품보다 실험과 축적을 위한 기반에 가깝다.

- 커뮤니티 Spline 코드를 가져와 수정할 수 있어야 한다.
- 손 추적 입력은 계속 바뀔 수 있어야 한다.
- 개별 작업물은 정적 배포 가능한 단위로 유지한다.
- 나중에 도메인만 연결해도 바로 공개 가능한 구조를 목표로 한다.
