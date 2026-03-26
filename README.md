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
- 현재는 다음 두 작업물이 연결되어 있다.
  - `Solar Orrery`
  - `NBV Robotics Lab`

## 현재 제스처 기반 동작 개요

- 허브
  - 오른손 검지 위치를 커서처럼 사용
  - 왼손 제스처로 메뉴 진입 및 프로젝트 실행
- Solar Orrery
  - 태양계 공전 시뮬레이션
  - 행성 포커스, 블랙홀 오버레이, 메뉴 복귀 제스처 포함
- NBV Robotics Lab
  - 오른손 `pinch`: 물체 grasp 및 이동
  - 왼손 `fist + drag`: 시야 이동
  - 왼손 `pinch`: 현재 가리키는 물체를 자동 플래너의 우선 목표로 지정
  - 양손 `fist`: 허브 메뉴로 복귀
  - 사용자가 가만히 있으면 로봇이 자동으로 NBV와 grasp planning을 수행

## NBV Robotics Lab 설명

이 작업물은 연속된 single-view 기반 3D semantic segmentation을 직관적으로 보여주기 위한 브라우저 시뮬레이션이다.

- occlusion이 있는 작업대 환경을 만든다.
- 후보 view들 중 어느 방향이 information gain이 큰지 계산한다.
- 각 물체의 uncertainty가 시간이 지나며 어떻게 줄어드는지 추적한다.
- 물체별 confidence를 화면 위 물체 라벨에 직접 표시한다.
- 충분한 관측이 쌓이면 two-finger gripper 기준으로 grasp 가능성을 평가한다.
- 모든 물체에 대한 grasp planning이 끝나면 로봇팔이 자동으로 grasp를 수행한다.

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
