# Hub

`apps/hub`는 HandDock의 실제 메인 앱이다.  
사용자는 이 허브에서 손 제스처를 이용해 각 작업물로 들어가고, 다시 허브로 돌아온다.

## 현재 화면 구성

- 로봇 랜딩 화면
  - 검은 배경 위 Spline 로봇 장면
  - 우측 상단의 회전하는 와이어프레임 정육면체 버튼으로 메뉴 진입 가능
- 브레인 메뉴 화면
  - 프로젝트 구체들이 브레인 장면 위에 배치됨
  - 현재는 `Solar Orrery`, `NBV Robotics Lab`, `WallCL`, `SMoL` 네 작업물을 유지
- 작업물 상세 화면
  - 각 작업물별 인터랙션 컴포넌트로 분기

## 현재 구현된 기능

- 웹캠 권한 요청 및 실시간 손 추적
- 오른손 기반 커서 이동
- 왼손 제스처 기반 메뉴 진입 및 선택
- 카메라 프리뷰와 손끝 시각화 오버레이
- 정적 export 가능한 Next.js 구조
- 개별 작업물 페이지 라우팅 및 메뉴 복귀 연결

## 주요 제스처

- 허브 공통
  - 오른손 검지: 포인터 이동
  - 메뉴 구체 hover + 왼손 활성 제스처: 프로젝트 진입
  - 우하단 `Exit` 버튼 hover + 왼손 주먹 유지: 허브 복귀
- Solar Orrery
  - 행성 선택, 블랙홀 오버레이, 복귀 제스처 지원
- NBV Robotics Lab
  - 오른손 `pinch`: 물체 grasp 및 이동
  - 왼손 `pinch`: 자동 플래너 우선 대상 지정
  - 오른손 `pinch`: 우상단 속도 바 조절에도 사용
- WallCL
  - 자동 클라이밍 사이클 재생
  - 대회 제약, 설계 변경, 하드웨어 리스크까지 포함한 wall-climbing 설계 기록
- SMoL
  - 빛 번짐 synthetic data, contrastive alignment, domain adaptation, glare-robust line detection 시각화

## 개발 메모

- `app/components/HandDockHome.tsx`
  - 허브 공통 손 추적과 메뉴 제어 중심 파일
- `app/work-data.ts`
  - 허브에 노출할 프로젝트 메타데이터
- `app/works/[slug]/page.tsx`
  - 작업물별 라우팅 분기
- `app/components/WallClExperience.tsx`
  - wall climbing gait와 예상 하드웨어 설계 화면
- `app/components/SmolExperience.tsx`
  - SMoL 학습 과정과 glare-robust line detection 시각화 화면

## 목표

이 앱은 단순한 링크 모음이 아니라, 여러 작업물을 하나의 손 기반 브라우저처럼 연결하는 로컬 포털 역할을 한다.
