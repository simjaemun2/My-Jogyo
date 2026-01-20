---
name: jito-mev-bundle
description: "Jito Block Engine을 통해 MEV 보호 및 우선순위 실행을 위한 트랜잭션 번들을 구성하고 전송하는 스킬. 원자적 실행, 우선순위 보장, MEV 보호 번들 구성을 다룹니다."
---

# Jito MEV 번들 Skill

## 개요
Jito Block Engine을 통해 MEV 보호 및 우선순위 실행을 위한 트랜잭션 번들을 구성하고 전송하는 시스템입니다. 이 skill은 차익거래 기회 발견 시 안전하고 효율적으로 트랜잭션을 실행하는 데 필수적입니다.

## 핵심 개념

### Jito Block Engine이란?
Jito는 Solana 메인넷의 MEV(Maximum Extractable Value) 인프라입니다. 일반 RPC로 트랜잭션을 전송하면 다른 봇들에게 선점당할 수 있지만, Jito를 통하면:
- **원자적 실행**: 번들 내 모든 트랜잭션이 함께 성공하거나 함께 실패
- **우선순위 보장**: 팁(tip)을 지불하여 블록 내 우선 실행
- **MEV 보호**: 트랜잭션이 공개 멤풀에 노출되지 않음

## 주요 구성 요소

### 1. JitoBundleBuilder (src/jito_bundle.rs)

#### 초기화
```rust
use arbitrage::jito_bundle::{JitoBundleBuilder, JitoRegion};

let builder = JitoBundleBuilder::new(
    JitoRegion::NewYork,  // 또는 Tokyo, Amsterdam, Frankfurt, Mainnet
    "http://localhost:8899"  // Solana RPC URL
)?;
```

#### 지원 리전
| 리전 | 엔드포인트 | 권장 사용처 |
|------|-----------|------------|
| NewYork | ny.mainnet.block-engine.jito.wtf | 미국 동부 |
| Tokyo | tokyo.mainnet.block-engine.jito.wtf | 아시아 |
| Amsterdam | amsterdam.mainnet.block-engine.jito.wtf | 유럽 |
| Frankfurt | frankfurt.mainnet.block-engine.jito.wtf | 유럽 |
| Mainnet | mainnet.block-engine.jito.wtf | 기본값 |

### 2. 번들 구조

#### 올바른 번들 구성
```rust
// 1. 차익거래 트랜잭션들 (최대 4개)
let swap_tx_1 = create_swap_transaction(...);
let swap_tx_2 = create_swap_transaction(...);

// 2. 팁 트랜잭션 (반드시 마지막)
let tip_tx = builder.create_tip_transaction(&payer, tip_lamports)?;

// 3. 번들 생성 (순서 중요!)
let bundle = vec![swap_tx_1, swap_tx_2, tip_tx];
```

#### 번들 제약사항
- **최대 트랜잭션 수**: 5개
- **팁 위치**: 반드시 마지막 트랜잭션
- **Blockhash**: 모든 트랜잭션이 동일한 recent blockhash 사용
- **서명**: 모든 트랜잭션이 사전 서명되어야 함

### 3. 팁(Tip) 시스템

#### 공식 팁 계정
Jito는 8개의 공식 팁 계정을 운영합니다 (무작위 선택):
```
96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5
HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe
ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49
DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh
ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt
DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL
3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT
(총 8개)
```

#### 최소 팁 금액
```rust
const MINIMUM_JITO_TIP: u64 = 1_000; // 0.000001 SOL
```

#### 동적 팁 계산 전략
```rust
fn calculate_optimal_tip(profit_lamports: u64) -> u64 {
    // 전략 1: 이익의 5% 팁
    let tip_from_profit = profit_lamports / 20;

    // 전략 2: 최소 팁 보장
    let minimum_tip = 10_000; // 0.00001 SOL

    // 전략 3: 경쟁 상황 고려
    let competitive_tip = 50_000; // 0.00005 SOL

    tip_from_profit.max(minimum_tip).min(competitive_tip)
}
```

### 4. 번들 제출 및 모니터링

#### 기본 제출
```rust
// 번들 제출
let bundle_uuid = builder.send_bundle(transactions)?;
info!("Bundle submitted: {}", bundle_uuid);
```

#### 제출 및 확인
```rust
// 번들 제출 + 상태 폴링 (권장)
let status = builder.send_and_confirm_bundle(
    transactions,
    60  // 최대 60번 폴링 (60초)
)?;

match status.status.as_str() {
    "Landed" => {
        info!("Bundle landed in slot: {:?}", status.landed_slot);
    },
    "Failed" => {
        warn!("Bundle failed to land");
    },
    _ => {}
}
```

#### 상태 폴링
```rust
// 수동 상태 확인
let status = builder.get_bundle_status(&bundle_uuid)?;

// 자동 폴링 (권장)
let final_status = builder.poll_bundle_status(
    &bundle_uuid,
    60,  // max_retries
    Duration::from_secs(1)  // poll_interval
)?;
```

## 번들 상태 및 에러 처리

### 번들 상태
- **Pending**: 번들이 실행 대기 중
- **Landed**: 번들이 온체인에 성공적으로 랜딩
- **Failed**: 번들 실행 실패
- **NotFound**: 번들을 찾을 수 없음

### 실패 원인 및 해결책

#### 1. 팁이 너무 적음
```
Error: "Bundle rejected - insufficient tip"
해결: 팁 금액 증가 (최소 0.0001 SOL 권장)
```

#### 2. 트랜잭션 순서 오류
```
Error: "Tip transaction must be last"
해결: 팁 트랜잭션을 번들의 마지막으로 이동
```

#### 3. Blockhash 만료
```
Error: "Blockhash not found"
해결: 새로운 blockhash로 트랜잭션 재생성
```

#### 4. 번들 크기 초과
```
Error: "Bundle cannot contain more than 5 transactions"
해결: 트랜잭션을 여러 번들로 분할
```

#### 5. Rate Limiting
```
Error: "Jito rate limited"
해결: 요청 간 간격 증가 또는 다른 리전 시도
```

## Fallback 전략

### BundleSender 구현 (src/engine/bundle/bundle_sender.rs)
```rust
pub async fn run(
    config: Arc<Config>,
    rpc_client: Arc<RpcClient>,
    mut rx: Receiver<BundleTransaction>,
) -> Result<()> {
    while let Some(bundle_tx) = rx.recv().await {
        // 1. Jito 시도
        match send_jito_bundle(...).await {
            Ok(bundle_uuid) => {
                info!("Bundle sent via Jito: {}", bundle_uuid);
                tokio::spawn(monitor_bundle_status(...));
            }
            Err(e) => {
                warn!("Jito failed: {}", e);

                // 2. Fallback to direct RPC
                match send_direct_rpc(&bundle_tx, &rpc_client, &config).await {
                    Ok(signature) => {
                        info!("Transaction sent via RPC: {}", signature);
                    }
                    Err(e) => {
                        error!("Both Jito and RPC failed: {}", e);
                    }
                }
            }
        }
    }
    Ok(())
}
```

### Direct RPC 설정
```rust
let send_config = RpcSendTransactionConfig {
    skip_preflight: true,
    preflight_commitment: Some(CommitmentLevel::Confirmed),
    encoding: None,
    max_retries: Some(3),
    min_context_slot: None,
};
```

## 테스트 및 검증

### 테스트 바이너리
```bash
# Dry run 테스트
cargo run --bin test_jito_bundle -- \
    --keypair ~/liquidator.json \
    --tip 10000 \
    --region NY \
    --dry-run

# 실제 제출 테스트
cargo run --bin test_jito_bundle -- \
    --keypair ~/liquidator.json \
    --tip 50000 \
    --region NY
```

### 로그 모니터링
```bash
# 번들 제출 로그 확인
grep "Bundle sent successfully" logs/*.log

# 실패 원인 분석
grep -E "Bundle.*failed|error" logs/*.log

# 상태 추적
grep "Bundle.*status" logs/*.log
```

## 성능 최적화

### 1. 리전 선택
- 가장 가까운 리전 사용
- 지연시간 < 100ms 목표

### 2. 팁 최적화
```rust
// 이익 대비 팁 비율
let tip_ratio = 0.05; // 5%

// 경쟁 상황 고려
let base_tip = 10_000; // 0.00001 SOL
let competitive_multiplier = match competition_level {
    High => 5.0,
    Medium => 2.0,
    Low => 1.0,
};

let optimal_tip = (profit * tip_ratio).max(base_tip * competitive_multiplier);
```

### 3. 번들 구성 최적화
```rust
// 전략 1: 단일 경로 차익거래
let bundle = vec![
    swap_on_dex_a,  // SOL → USDC
    swap_on_dex_b,  // USDC → SOL
    tip_tx
];

// 전략 2: 다중 경로 (4 DEX)
let bundle = vec![
    swap_1,  // SOL → USDC (Raydium)
    swap_2,  // USDC → BONK (Orca)
    swap_3,  // BONK → USDT (Meteora)
    swap_4,  // USDT → SOL (Raydium)
    tip_tx
];
```

## 주요 코드 위치

### 핵심 파일
- **번들 빌더**: `src/jito_bundle.rs`
- **번들 전송**: `src/engine/bundle/bundle_sender.rs`
- **V2 구현**: `src/engine/bundle/jito_bundle_builder_v2.rs` (개발 중)
- **테스트**: `src/bin/test_jito_bundle.rs`

### 관련 모듈
```
src/
├── jito_bundle.rs              # 메인 번들 빌더
├── jito_grpc_bundle.rs         # gRPC 기반 구현
├── swap/
│   └── jito.rs                 # 스왑 + Jito 통합
└── engine/
    └── bundle/
        ├── bundle_sender.rs     # 비동기 번들 전송
        ├── jito_bundle_builder.rs
        └── jito_bundle_builder_v2.rs
```

## 관련 에이전트

### jito-mev-specialist
Jito MEV 전략 전문가 에이전트:
- 팁 최적화 전략
- 번들 구성 최적화
- 경쟁 분석
- 수익성 계산

## 트러블슈팅 가이드

### 문제: 번들이 계속 Pending 상태
**원인**: 팁이 너무 적거나 경쟁이 심함
**해결**:
```rust
// 팁 증가
let increased_tip = current_tip * 2;

// 또는 다른 리전 시도
let builder = JitoBundleBuilder::new(JitoRegion::Tokyo, rpc_url)?;
```

### 문제: "Blockhash not found"
**원인**: 트랜잭션 생성 후 시간이 너무 지남
**해결**:
```rust
// 번들 전송 직전에 새 blockhash 사용
let recent_blockhash = builder.rpc_client.get_latest_blockhash()?;
for tx in &mut transactions {
    tx.message.recent_blockhash = recent_blockhash;
    tx.sign(&[&payer], recent_blockhash);
}
```

### 문제: Rate Limiting
**원인**: 너무 많은 요청
**해결**:
```rust
// 요청 간 딜레이 추가
tokio::time::sleep(Duration::from_millis(500)).await;

// 또는 다른 리전으로 로드 분산
let regions = vec![
    JitoRegion::NewYork,
    JitoRegion::Tokyo,
    JitoRegion::Amsterdam,
];
let region = regions[bundle_count % regions.len()];
```

### 문제: 번들은 Landed되었는데 차익거래 실패
**원인**: 가격 변동 또는 슬리피지 초과
**해결**:
```rust
// 슬리피지 관리 추가
let max_slippage = 0.01; // 1%
let min_output = expected_output * (1.0 - max_slippage);

// 트랜잭션에 최소 출력 검증 추가
```

## 베스트 프랙티스

### 1. 환경 변수 설정
```bash
export JITO_URL="https://ny.mainnet.block-engine.jito.wtf/api/v1"
export JITO_TIP_ACCOUNT=""  # 비어있으면 자동 선택
export MIN_PROFIT_FOR_JITO=100000  # 0.0001 SOL
```

### 2. 에러 처리
```rust
match builder.send_and_confirm_bundle(bundle, 60) {
    Ok(status) if status.status == "Landed" => {
        // 성공 처리
    },
    Ok(status) => {
        warn!("Bundle did not land: {}", status.status);
        // Fallback 로직
    },
    Err(e) => {
        error!("Bundle submission error: {}", e);
        // Direct RPC 시도
    }
}
```

### 3. 로깅
```rust
use tracing::{info, warn, error, debug};

debug!("Creating bundle with {} transactions", txs.len());
info!("Bundle submitted: {}", bundle_uuid);
warn!("Bundle pending for {} seconds", elapsed);
error!("Bundle failed: {}", error);
```

### 4. 모니터링
```rust
// 번들 상태 추적
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(2));
    for _ in 0..30 {
        interval.tick().await;
        match builder.get_bundle_status(&bundle_uuid) {
            Ok(status) => {
                info!("Bundle {}: {}", bundle_uuid, status.status);
                if status.status != "Pending" {
                    break;
                }
            }
            Err(e) => {
                warn!("Status check failed: {}", e);
            }
        }
    }
});
```

## 참고 자료

### 공식 문서
- [Jito Labs GitBook](https://jito-labs.gitbook.io/mev)
- [Jito Rust RPC SDK](https://github.com/jito-labs/jito-rust-rpc)

### 내부 문서
- [BundleSender 구현](../../../src/engine/bundle/bundle_sender.rs)
- [Jito 통합 가이드](../../../docs/jito_integration.md)

---
**최종 업데이트**: 2025-11-30
**작성자**: Claude Code
**버전**: 1.0.0
