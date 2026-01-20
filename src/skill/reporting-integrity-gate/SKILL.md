---
name: reporting-integrity-gate
description: "로그 기반 지표와 보고서가 일치하는지 검증하고 STOP-SHIP 여부를 결정하는 게이트 절차. audit 요청, 결과 보고서 작성, full-pipeline 결과 검증 시 사용."
---

# Reporting Integrity Gate

## 개요
로그 경로를 명시적으로 고정하고, 보고서 수치와 로그 직접 카운트를 일치시켜 **허위 성공/결과 부족 현상**을 차단하라.

## 사용 시점
- 보고서가 성과를 주장하거나 Exit Criteria를 PASS로 판정할 때
- audit/inspector가 불일치를 지적했을 때
- full-pipeline 결과 요약 전에 수치 검증이 필요할 때

## 워크플로 (필수)
1. **로그 경로를 고정하라**
   - `--log <path>`로 대상 로그 파일을 명시하라.
   - `latest`/심링크/추정 경로 사용을 금지하라.
2. **로그 직접 카운트를 수행하라**
   - `rg -c` 또는 `scripts/check_report_integrity.py`를 사용하라.
   - 최소 기준: `valid_opps`, `BUNDLE_CONTEXT`, `cycle_integrity_verified`, `PREFLIGHT_VALIDATION_PASS`, `BUNDLE_SEND_SUCCESS`.
3. **보고서 수치와 1:1로 대조하라**
   - 불일치 시 **STOP-SHIP**로 표기하고 결과를 무효 처리하라.
4. **불일치 원인을 분류하라**
   - 로그 경로 착오 / 보고서 스크립트 로직 / 환경변수 불일치 / 동적 풀 비활성 등으로 구분하라.
5. **증거 로그를 문서에 포함하라**
   - `ALERT_SUMMARY`, `HEARTBEAT_METRIC`, `Dynamic pools` 라인을 그대로 첨부하라.
6. **마일스톤을 동기화하라**
   - STOP-SHIP 사유와 해제 조건을 명시하라.

## 스크립트 사용법
- **정합성 체크**:
  - `scripts/check_report_integrity.py --log <log_path> --pretty`
- **JSON 저장**:
  - `scripts/check_report_integrity.py --log <log_path> --json <output.json>`

## 출력 요건
- 보고서에 **로그 경로 + 직접 카운트 결과**를 반드시 기록하라.
- `valid_opps=0`인데 “성공” 판정을 금지하라.
- 불일치가 해결되기 전까지 후속 실행(장기 테스트)을 진행하지 말라.
