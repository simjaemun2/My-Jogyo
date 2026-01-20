# Reporting Integrity Gate 참고 문서

## 목적
보고서 수치와 로그 직접 카운트를 일치시키고, 불일치 시 STOP-SHIP로 전환하여
"허위 성공"과 "결과 부족" 현상을 사전에 차단한다.

## 핵심 체크리스트
1. **로그 경로 고정**: 반드시 `--log <path>`를 명시한다.
2. **직접 카운트**: `rg -c` 또는 `check_report_integrity.py`로 주요 지표를 추출한다.
3. **수치 일치 확인**: 보고서 수치가 로그 카운트와 다르면 즉시 중단한다.
4. **원인 분류**: 경로 착오/스크립트 로직/환경변수/동적 풀 문제를 구분한다.
5. **마일스톤 갱신**: STOP-SHIP 사유와 해제 조건을 기록한다.

## 최소 지표
- valid_opps
- BUNDLE_CONTEXT
- cycle_integrity_verified
- PREFLIGHT_VALIDATION_PASS
- BUNDLE_SEND_SUCCESS

## 증거 로그
- ALERT_SUMMARY
- HEARTBEAT_METRIC
- Dynamic pools
