---
name: geyser-grpc-integration
description: "Yellowstone Geyser Plugin gRPC를 통한 실시간 블록체인 데이터 스트리밍 스킬. Account 구독, Transaction 스트리밍, Backpressure 처리 및 DEX별 어댑터를 다룹니다."
---

# Geyser gRPC Integration Skill

## 개요
Yellowstone Geyser Plugin gRPC는 Solana validator에서 실시간 블록체인 데이터를 스트리밍하는 고성능 데이터 소스입니다. 전통적인 WebSocket 방식 대비 5배 이상의 처리량과 10배 낮은 지연시간을 제공하며, Protobuf 기반의 효율적인 바이너리 데이터 전송을 지원합니다.

### 주요 장점
| 항목 | WebSocket | Geyser gRPC |
|------|-----------|-------------|
| **지연시간** | ~100ms | ~10ms |
| **처리량** | ~100 events/sec | 560+ events/sec |
| **연결 안정성** | 재연결 필요 | 매우 안정적 |
| **CPU 사용률** | 높음 (JSON 파싱) | 낮음 (Protobuf) |
| **메모리 사용** | 높음 | 최적화됨 |
| **프로토콜** | WebSocket (텍스트) | HTTP/2 (바이너리) |

## 핵심 개념

### 1. Account Subscribe (계정 구독)
특정 DEX 프로그램 또는 풀 계정의 상태 변경을 실시간으로 모니터링합니다.

**사용 사례**:
- Pool 상태 변경 감지 (vault 잔고, 가격, 유동성)
- Oracle 가격 업데이트 추적
- 새로운 풀 생성 감지

**구현 위치**: `src/geyser/grpc_client.rs`

```rust
// Account 구독 예시
SubscribeRequestFilterAccounts {
    account: vec![],  // 모든 계정
    owner: vec![program_id.to_string()],  // 특정 프로그램 소유
    filters: vec![],
}
```

### 2. Transaction Streaming (트랜잭션 스트리밍)
블록체인에 기록된 트랜잭션과 그 로그를 실시간으로 수신합니다.

**사용 사례**:
- Swap 이벤트 로그 추출
- 트랜잭션 성공/실패 모니터링
- Inner instruction 파싱

**구현 위치**: `src/geyser/grpc_client.rs`

```rust
// Transaction 구독 예시
SubscribeRequestFilterTransactions {
    vote: Some(false),  // Vote 트랜잭션 제외
    failed: Some(false),  // 실패 트랜잭션 제외
    account_include: tracked_programs,  // 특정 프로그램만
    ..Default::default()
}
```

### 3. Backpressure 처리
대량의 데이터 스트림을 버퍼링하고 적절히 처리합니다.

**전략**:
- **Channel 기반 버퍼링**: `mpsc::channel(10000)` 크기 조절
- **Bounded Channel 사용**: 메모리 제한 적용
- **Selective Filtering**: 관심 있는 이벤트만 처리
- **Batch Processing**: 여러 이벤트 묶어서 처리

**구현 위치**: `src/geyser/grpc_client.rs`, `src/geyser/manager.rs`

## 아키텍처

### 디렉토리 구조
```
src/geyser/
├── grpc.rs                      # Proto 래퍼 모듈
├── grpc_client.rs               # gRPC 클라이언트 구현 ⭐
├── manager.rs                   # Geyser 매니저 (WebSocket 폴백)
├── manager_no_mock.rs           # Mock 없는 매니저
├── real_client.rs               # 프로덕션 클라이언트
├── grpc/
│   ├── geyser.rs                # 생성된 proto 코드
│   └── solana.storage.confirmed_block.rs
└── adapters/                    # DEX별 어댑터
    ├── raydium_amm.rs           # Raydium AMM V4
    ├── raydium_clmm.rs          # Raydium CLMM
    ├── orca.rs                  # Orca Whirlpool
    ├── meteora.rs               # Meteora DLMM
    ├── meteora_dammv2.rs        # Meteora DAMM v2
    ├── pancakeswap.rs           # PancakeSwap V3
    └── pumpfun.rs               # PumpFun AMM
```

### 데이터 흐름
```
Validator (Yellowstone Plugin)
    ↓ gRPC Stream (Protobuf)
GrpcGeyserClient (grpc_client.rs)
    ↓ AccountUpdate / TransactionUpdate
DEX Adapters (adapters/*.rs)
    ↓ SwapEvent / PoolStateUpdate
Price Processor (price_processor.rs)
    ↓ PriceEvent
Arbitrage Engine
```

## 주요 코드 위치

### 1. gRPC 클라이언트 (`src/geyser/grpc_client.rs`)
**역할**: Yellowstone gRPC 엔드포인트에 연결하고 스트림을 관리합니다.

**핵심 메서드**:
- `new()`: 클라이언트 초기화
- `connect()`: gRPC 연결 설정
- `subscribe_stream()`: Account/Transaction 구독 시작
- `handle_update()`: 수신된 업데이트 처리
- `health_check()`: 연결 상태 확인

**중요 필드**:
```rust
pub struct GrpcGeyserClient {
    endpoint: String,                       // 127.0.0.1:10000
    updates_tx: mpsc::Sender<GeyserUpdate>, // 통합 업데이트 채널
    account_updates_tx: mpsc::Sender,       // Account 전용 채널
    tx_updates_tx: mpsc::Sender,            // Transaction 전용 채널
    tracked_programs: Vec<Pubkey>,          // 추적 대상 프로그램
    cached_pool_addresses: HashSet<String>, // 캐시된 풀 주소
    metrics: SubscriptionMetrics,           // 성능 메트릭
}
```

### 2. DEX 어댑터 (`src/geyser/adapters/*.rs`)
**역할**: DEX별 데이터 파싱 및 이벤트 생성을 담당합니다.

**공통 Trait**:
```rust
#[async_trait]
pub trait GeyserAdapter: Send + Sync {
    // Account 업데이트 처리
    async fn handle_account_update(
        &self,
        account_update: &AccountUpdate,
    ) -> Result<Vec<SwapEvent>>;

    // Transaction 로그 처리
    async fn handle_transaction_update(
        &self,
        tx_update: &TransactionUpdate,
    ) -> Result<Vec<SwapEvent>>;
}
```

**어댑터별 특징**:
- **raydium_amm.rs**: ray_log 파싱, vault 잔고 추적
- **raydium_clmm.rs**: Tick array, sqrt_price 계산
- **orca.rs**: Whirlpool sqrt_price, tick spacing
- **meteora.rs**: DLMM bin step, active_id 기반 가격
- **pancakeswap.rs**: V3 concentrated liquidity, tick 관리

### 3. Geyser 매니저 (`src/geyser/manager.rs`)
**역할**: gRPC와 WebSocket 소스를 통합 관리하고 fallback 처리합니다.

**핵심 기능**:
- 이중 데이터 소스 관리 (gRPC 우선, WebSocket 폴백)
- DEX 어댑터 라우팅
- 메트릭 수집 및 로깅
- 에러 복구 및 재연결

## 설정 정보

### 환경 변수
```bash
# Geyser gRPC 엔드포인트
export GEYSER_HOST="127.0.0.1"
export GEYSER_PORT="10000"

# 활성화할 DEX 목록
export ENABLED_DEXES="raydium_amm,raydium_clmm,orca_whirlpool,meteora_dlmm,meteora_dammv2,pancakeswap"

# 로깅 레벨
export RUST_LOG="info"
export GEYSER_LOG_LEVEL="debug"  # gRPC 디버깅 시

# 구독 옵션
export GEYSER_ACCOUNT_SUBSCRIBE="true"
export GEYSER_TX_SUBSCRIBE="true"

# 성능 튜닝
export GEYSER_CHANNEL_SIZE="10000"  # Backpressure 버퍼 크기
export GEYSER_KEEPALIVE_INTERVAL="30"  # Keep-alive 간격 (초)
```

### Yellowstone 설치 경로
```bash
# Yellowstone Plugin 설치 위치
/opt/yellowstone-v3/

# 설정 파일
/opt/yellowstone-v3/yellowstone-grpc-geyser.json

# 로그 파일
/opt/yellowstone-v3/logs/
```

### Validator 설정
Validator가 Geyser Plugin을 로드하도록 설정해야 합니다:

```bash
# run_validator.sh에 추가
--geyser-plugin-config /opt/yellowstone-v3/yellowstone-grpc-geyser.json
```

## 사용 방법

### 1. 기본 실행
```bash
# gRPC 클라이언트 직접 실행
cargo run --bin geyser_grpc_client

# 또는 통합 arbitrage 실행 (gRPC 자동 사용)
cargo run --bin arbitrage
```

### 2. Dry Run 모드
```bash
# 실제 거래 없이 테스트
cargo run --bin geyser_grpc_client -- --dry-run

# 특정 DEX만 모니터링
cargo run --bin geyser_grpc_client -- --dex raydium_amm,orca_whirlpool
```

### 3. 디버깅 모드
```bash
# 상세 로그 출력
RUST_LOG=debug cargo run --bin geyser_grpc_client

# gRPC 프로토콜 레벨 디버깅
RUST_LOG=trace,tonic=debug cargo run --bin geyser_grpc_client
```

### 4. 성능 벤치마크
```bash
# 이벤트 처리 성능 측정
cargo run --bin test_geyser_integration -- --duration 300

# DEX별 성능 비교
cargo run --bin test_dex_geyser_simple
```

## 트러블슈팅

### 연결 실패

#### 증상
```
ERROR Failed to connect to Geyser endpoint: Connection refused
```

#### 해결 방법
1. **Yellowstone Plugin 상태 확인**
   ```bash
   netstat -tuln | grep 10000
   # 출력 없으면 Plugin 미실행
   ```

2. **Validator 로그 확인**
   ```bash
   tail -f /root/src/mev/validator.log | grep -i geyser
   # "Geyser plugin loaded" 메시지 확인
   ```

3. **설정 파일 검증**
   ```bash
   cat /opt/yellowstone-v3/yellowstone-grpc-geyser.json
   # bind_address가 0.0.0.0:10000인지 확인
   ```

4. **Validator 재시작**
   ```bash
   sudo systemctl restart validator
   # 또는
   ./run_validator.sh
   ```

### Backpressure 문제

#### 증상
```
WARN Channel full, dropping events
WARN Slow consumer detected
```

#### 해결 방법
1. **채널 크기 증가**
   ```rust
   // grpc_client.rs에서
   let (tx, rx) = mpsc::channel(20000);  // 기본 10000에서 증가
   ```

2. **선택적 필터링 적용**
   ```rust
   // 관심 있는 프로그램만 구독
   tracked_programs: vec![
       raydium_amm_program_id,
       orca_whirlpool_program_id,
   ]
   ```

3. **배치 처리 활성화**
   ```rust
   // 여러 이벤트 묶어서 처리
   while let Some(batch) = rx.recv_many(100, Duration::from_millis(10)) {
       process_batch(batch).await?;
   }
   ```

### 재연결 루프

#### 증상
```
INFO Reconnecting to Geyser...
ERROR Connection lost, retrying...
```

#### 해결 방법
1. **Exponential Backoff 적용**
   ```rust
   let mut retry_delay = Duration::from_secs(1);
   loop {
       match connect().await {
           Ok(_) => break,
           Err(e) => {
               warn!("Connection failed: {}, retrying in {:?}", e, retry_delay);
               tokio::time::sleep(retry_delay).await;
               retry_delay = std::cmp::min(retry_delay * 2, Duration::from_secs(60));
           }
       }
   }
   ```

2. **Keep-alive 활성화**
   ```rust
   let channel = Endpoint::from_shared(endpoint)?
       .timeout(Duration::from_secs(10))
       .keep_alive_timeout(Duration::from_secs(30))
       .connect()
       .await?;
   ```

3. **네트워크 안정성 확인**
   ```bash
   # Validator와의 연결 안정성 테스트
   ping -c 100 127.0.0.1
   ```

### 데이터 파싱 오류

#### 증상
```
ERROR Failed to parse account data: InvalidLength
WARN Unknown account structure
```

#### 해결 방법
1. **Account 크기 검증**
   ```rust
   if account_data.len() < expected_size {
       warn!("Account data too small: {} < {}", account_data.len(), expected_size);
       return Ok(vec![]);
   }
   ```

2. **Discriminator 확인**
   ```rust
   let discriminator = &account_data[0..8];
   if discriminator != EXPECTED_DISCRIMINATOR {
       debug!("Unknown account type, skipping");
       return Ok(vec![]);
   }
   ```

3. **Borsh 디시리얼라이제이션 에러 처리**
   ```rust
   match Pool::try_from_slice(&account_data) {
       Ok(pool) => process_pool(pool),
       Err(e) => {
           warn!("Failed to deserialize pool: {}", e);
           return Ok(vec![]);
       }
   }
   ```

### 메모리 누수

#### 증상
```
시간이 지날수록 메모리 사용량 증가
```

#### 해결 방법
1. **캐시 크기 제한**
   ```rust
   use lru::LruCache;

   let mut pool_cache = LruCache::new(1000);  // 최대 1000개만 캐시
   ```

2. **오래된 데이터 정리**
   ```rust
   let mut last_cleanup = Instant::now();
   if last_cleanup.elapsed() > Duration::from_secs(300) {
       cleanup_old_data();
       last_cleanup = Instant::now();
   }
   ```

3. **메모리 프로파일링**
   ```bash
   # Valgrind로 메모리 누수 감지
   valgrind --leak-check=full ./target/release/geyser_grpc_client
   ```

## 성능 메트릭

### 실측 데이터 (2025-09-08 기준)
- **Account Updates**: 560+ updates/sec
- **Transaction Processing**: < 10ms per tx
- **메모리 사용량**: WebSocket 대비 60% 감소
- **CPU 사용률**: WebSocket 대비 40% 감소
- **연결 안정성**: 99.9% uptime

### 모니터링 명령어
```bash
# 실시간 메트릭 확인
tail -f logs/geyser_*.log | grep -E "(events/sec|latency|memory)"

# DEX별 이벤트 통계
grep "SwapEvent" logs/geyser_*.log | awk '{print $5}' | sort | uniq -c

# 평균 지연시간 계산
grep "latency:" logs/geyser_*.log | awk '{sum+=$NF; n++} END {print sum/n "ms"}'
```

## 관련 에이전트

이 skill은 다음 sub-agent와 연계하여 사용할 수 있습니다:

### geyser-debugger
Geyser gRPC 스트림의 디버깅 및 문제 해결을 전담합니다.

**사용 시점**:
- 연결 문제 발생 시
- 데이터 파싱 오류 디버깅
- 성능 병목 분석

**관련 파일**:
- `docs/20251121/102000_p14c_replay_v4b_guideline.md`
- `src/bin/test_geyser_*.rs`

## 추가 리소스

### 내부 문서
- [Geyser 스트림 분리 가이드](../../docs/20251121/102000_p14c_replay_v4b_guideline.md)
- [DEX 캐시 생성 가이드](../../docs/20250910/064000_dex_cache_generation_guide.md)
- [Sub-Agent 구성 가이드](../../SUB_AGENT_GUIDE.md)

### 외부 링크
- [Yellowstone gRPC Plugin](https://github.com/rpcpool/yellowstone-grpc)
- [gRPC Protobuf Specification](https://grpc.io/docs/languages/rust/)
- [Solana Geyser Plugin Interface](https://docs.solana.com/developing/plugins/geyser-plugins)

---
*최종 업데이트: 2025-11-30*
*버전: 1.0*
