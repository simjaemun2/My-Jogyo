---
name: cache-management
description: "DEX 풀 캐시 관리 및 최적화 스킬. 크로스 DEX 캐시 빌드, 워밍업, 메타데이터 관리, Unified v1 통합 캐시 시스템을 다룹니다."
---

# DEX Pool Cache Management

## 개요
Solana DEX 차익거래 시스템의 핵심 캐시 관리 스킬입니다. 6개 DEX의 풀 데이터를 효율적으로 캐싱하고 크로스 DEX 토큰을 자동 감지합니다.

**최종 업데이트**: 2026-01-02
**적용 범위**: Raydium AMM/CLMM/CPMM, Orca Whirlpool, Meteora DLMM, PumpFun AMM

## 사용 시점

다음 상황에서 이 스킬을 사용하세요:
- 캐시 빌드 또는 업데이트 작업
- Cross-DEX 토큰 분석
- 캐시 무결성 검증
- 워밍업 프로세스 디버깅
- 메타데이터 (decimals, symbols) 관리

## 캐시 시스템 구조

### Unified v1 통합 캐시 구조
```
arbitrage/data/cache/
├── unified_v1.json                  # 메인 통합 캐시 (RPC 파싱 결과)
├── cross_dex_warmup_latest.json     # unified_v1.json 심링크
├── raydium_amm_pools.json           # Raydium AMM V4 풀
├── raydium_clmm_pools.json          # Raydium CLMM 풀
├── raydium_cpmm_pools.json          # Raydium CPMM 풀
├── orca_whirlpool_pools.json        # Orca Whirlpool 풀
├── meteora_dlmm_pools.json          # Meteora DLMM 풀
└── token_metadata.json              # 토큰 메타데이터 (decimals, symbols)
```

**Note**: RPC 데이터(온체인)를 "소스 오브 트루스"로 사용해 mint mismatch를 줄입니다.

### Cross-DEX 캐시 스키마
```json
{
  "version": "unified_v1",
  "build_timestamp": "2026-01-02T00:00:00Z",
  "pools": [
    {
      "address": "풀 주소",
      "dex_type": "raydium_amm|raydium_clmm|orca|meteora|pumpfun",
      "token_a": {
        "mint": "토큰 민트 주소",
        "symbol": "SOL",
        "decimals": 9
      },
      "token_b": {
        "mint": "토큰 민트 주소",
        "symbol": "USDC",
        "decimals": 6
      },
      "fee_rate": 0.0025,
      "is_cross_dex": true
    }
  ],
  "cross_dex_tokens": ["SOL", "USDC", "USDT", ...],
  "statistics": {
    "total_pools": 1234,
    "cross_dex_pools": 456,
    "dex_breakdown": {
      "raydium_amm": 200,
      "raydium_clmm": 150,
      "orca": 100,
      "meteora": 80,
      "pumpfun": 50
    }
  }
}
```

## 주요 명령어

### 전체 캐시 빌드
```bash
cd /home/ubuntu/src/mev/arbitrage

# Unified v1 통합 캐시 빌드 (권장)
python3 build_unified_cache_v1.py

# 출력 파일:
# - arbitrage/data/cache/unified_v1.json (메인 통합 캐시)
# - arbitrage/data/cache/cross_dex_warmup_latest.json (심링크)
```

### 개별 DEX 캐시 관리
```bash
# Raydium API 캐시 상태 확인
./target/release/test_raydium_api_cache status

# Raydium 캐시 초기화
./target/release/test_raydium_api_cache init

# 캐시 업데이트 (백업 포함)
./target/release/test_raydium_api_cache update --backup
```

### 캐시 검증
```bash
# 캐시 무결성 검사
cargo run --bin verify_cache_integrity

# 크로스 DEX 토큰 분석
cargo run --bin analyze_cross_dex_tokens
```

## 캐시 빌드 워크플로

### 1. 사전 조건 확인
- RPC 연결 상태 확인
- 디스크 공간 확인 (최소 1GB 여유)
- 기존 캐시 백업

### 2. DEX별 캐시 빌드 순서
1. **Raydium AMM V4**: API에서 풀 목록 다운로드 → 거래량 기준 상위 50개 선택
2. **Raydium CLMM**: API에서 풀 목록 다운로드 → 거래량 기준 상위 50개 선택
3. **Raydium CPMM**: 모든 활성 풀 로드
4. **Orca Whirlpool**: API에서 풀 목록 다운로드 → 거래량 기준 상위 50개 선택
5. **Meteora DLMM**: API에서 풀 목록 다운로드 → 거래량 기준 상위 50개 선택
6. **PumpFun AMM**: 졸업한 토큰 자동 필터링

### 3. 크로스 DEX 토큰 감지
- 2개 이상의 DEX에 존재하는 토큰 식별
- 토큰별 풀 매핑 생성
- 차익거래 가능 페어 목록 생성

### 4. 메타데이터 보강
- 각 토큰의 decimals 정보 추가
- 심볼 정보 추가 (API 또는 온체인)
- 누락된 메타데이터 기본값 설정

## 문제 해결

### 캐시 빌드 실패
```bash
# 로그 확인
tail -f logs/cache_build_*.log

# RPC 연결 테스트
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://localhost:8899
```

### Decimals 누락
- `token_metadata.json`에서 토큰 확인
- 온체인에서 직접 조회: `solana account <mint_address> -ul`
- 기본값 6 (대부분의 SPL 토큰)

### 캐시 불일치
- 타임스탬프 확인 (24시간 이상 경과 시 재빌드)
- 버전 확인 (unified_v1 형식)
- 백업에서 복원 후 재빌드

## 성능 최적화 팁

1. **메모리 사용량**: 전체 캐시 로드 시 ~500MB, 필요한 DEX만 로드 권장
2. **빌드 시간**: 전체 캐시 빌드 약 5-10분 소요
3. **업데이트 주기**: 24시간마다 자동 갱신, 긴급 시 수동 갱신
4. **백업 정책**: 빌드 전 자동 백업, 최근 3개 버전 유지

## 관련 파일 위치

- **캐시 빌더 (Unified v1)**: `arbitrage/build_unified_cache_v1.py`
- **캐시 데이터**: `arbitrage/data/cache/unified_v1.json`
- **워밍업 심링크**: `arbitrage/data/cache/cross_dex_warmup_latest.json`
- **캐시 로더**: `arbitrage/src/engine/pool_vault_cache.rs`
- **크로스 DEX 필터**: `arbitrage/src/engine/cross_dex_filter.rs`
- **메타데이터 관리**: `arbitrage/src/tokens.rs`

## 관련 에이전트

- `cache-optimizer`: 캐시 성능 최적화 전문
- `cross-dex-cache-builder`: 크로스 DEX 캐시 빌드 전문
