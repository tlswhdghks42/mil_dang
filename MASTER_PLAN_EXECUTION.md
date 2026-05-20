# 밀당(Mildang) 마스터 플랜 실행 현황

## Phase 1 (완료)
- 통합 데이터 모델, 혈당 분기 로직, SafetyEvent(15분/30분) 구현
- Home/Input/Result/Exit 화면 컴포넌트와 컨트롤러/런타임 상태 저장 구현
- 경계값 및 상태전이 단위 테스트 구현

## Phase 2 (완료)
1. 날씨 API 연동 계층
2. AI 식단 음성 분석 계층
3. 보건소 QR 대시보드 매핑(서명/만료/issuer/audience 검증)
4. 보호자 동기화 payload + 전송 채널(push 우선, sms fallback, retry/audit)
5. 로컬 챌린지 판정 + GPS 지오펜스 검증 + audit 저장

## Phase 3 (완료)
1. LLM 중재문구 보정 체인 (`phase3InterventionLLM.ts`)
   - 컨텍스트(신호등/날씨/식단/증상/복약) 기반 프롬프트 빌더
   - 고위험(red/critical_low) 전용 응급 프롬프트 템플릿 분리
   - 안전 문구 가드레일: 신호별 금지 표현/필수 표현 검증기
   - LLM 응답 공백/가드레일 실패 시 기본 문구 fallback
2. Phase1/2 흐름에 LLM 보정 체인 실제 연결
   - `analyzeMeasurementWithLlm` (phase1Flow) - LLM 옵션 통합
   - `analyzeAndMoveResultWithLlm` (phase1Controller) - 컨트롤러 레벨 async 통합
3. 토큰/지연시간/실패율 관측 지표 (`phase3Metrics.ts`)
   - LlmCallMetric: callId/promptVersion/signal/latencyMs/inputToken/outputToken/guardrailPassed
   - InMemoryMetricsCollector: record/summary(avgLatency/p95/failureRate/guardrailFailRate)
4. 프롬프트 버전 관리 및 A/B 템플릿 (`phase3PromptRegistry.ts`)
   - PromptRegistry: 버전별 템플릿 등록/조회
   - assignAbVariant: userId+experimentId 해시 기반 결정론적 A/B 배정
   - 내장 템플릿: standard-v1(표준 지시형), empathetic-v2(공감형)

## Phase 4 (완료)
1. 수영구 날씨 API 실연결 (`phase4WeatherAdapter.ts`)
   - 기상청(KMA) 초단기실황 API 어댑터 (수영구 격자 nx=99, ny=75)
   - 5분 TTL 캐시로 과도한 API 호출 방지
   - HTTP 재시도 (exponential backoff, 최대 3회)
   - 환경변수(WEATHER_API_KEY) 기반 설정 로더
2. 보호자 동기화 실어댑터 (`phase4GuardianAdapters.ts`)
   - FCM HTTP v1 PushSender (Android 우선순위 high 설정)
   - 알리고 SMS SmsSender (form-encoded POST)
   - InMemoryGuardianChannel → SSE/WebSocket 교체 가능한 실시간 채널 인터페이스
   - notifyGuardiansOnMeasurement: 연결된 보호자에게 일괄 실시간 발송
   - 환경변수(FCM_PROJECT_ID, ALIGO_API_KEY 등) 기반 설정 로더
3. QR 대시보드 데이터 서비스 (`phase4Dashboard.ts`)
   - BloodSugarRepository 인터페이스 + InMemoryBloodSugarRepository
   - getDashboardData: QR 토큰 검증 후 혈당 기록 조회 및 집계
   - DashboardStats: 평균혈당/신호 분포/green 비율/마일리지 합계
   - DashboardAlerts: 고위험 신호 여부/연속 red 횟수 감지

## 전체 남은 단계 로드맵
2. Phase 5 (품질/운영)
   - 통합/E2E 테스트 자동화
   - 장애 복구 및 알림 누락 모니터링
   - 개인정보/의료정보 보안 점검, 파일럿 배포

## 참고
- 외부 API/실서버 연동은 인터페이스 중심으로 구현되어 실제 배포 전 엔드포인트 연결/인증 설정이 필요함.
- LLM 클라이언트(`LlmClient`)는 인터페이스로 분리되어 Claude/GPT 등 실제 제공자를 주입 가능.
