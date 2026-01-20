---
name: arbitrage-detection
description: "차익거래 기회를 실시간으로 감지하고 수익성을 분석하는 스킬. Bellman-Ford 알고리즘과 Enhanced Detector를 활용한 멀티 DEX 환경에서의 최적 차익거래 경로 탐색을 다룹니다."
---

# Arbitrage Detection Skill

## 개요
차익거래 기회를 실시간으로 감지하고 수익성을 분석하는 시스템입니다. Bellman-Ford 알고리즘과 Enhanced Detector를 활용하여 멀티 DEX 환경에서 최적의 차익거래 경로를 발견합니다.

## 주요 기능

### 1. 차익거래 감지 방식
- **Cross-DEX Arbitrage**: 서로 다른 DEX 간 가격 차이 감지
- **Triangular Arbitrage**: 단일 DEX 내 3개 이상 토큰 간 순환 차익거래
- **Direct Arbitrage**: 동일 토큰 쌍의 두 DEX 간 직접 차익거래

### 2. Bellman-Ford 알고리즘 기반 경로 탐색

#### 그래프 구조
```rust
// 노드: 토큰 (민트 주소 기반)
mint_to_id: HashMap<Pubkey, usize>    // 민트 주소 → 노드 ID
id_to_mint: HashMap<usize, Pubkey>    // 노드 ID → 민트 주소
id_to_symbol: HashMap<usize, String>  // 노드 ID → 심볼 (표시용)

// 엣지: DEX 풀 (가격 정보 포함)
edges: Vec<Edge> {
    from: usize,           // 출발 노드
    to: usize,             // 도착 노드
    weight: f64,           // -log(exchange_rate * (1 - fee))
    dex: String,           // DEX 식별자
    pool: Pubkey,          // 풀 주소
    liquidity: f64,        // 유동성 (USD)
}
```

#### 음의 사이클 탐지 원리
```rust
// 1. 가격 비율을 음의 로그 가중치로 변환
let exchange_rate = price_out / price_in;
let fee_adjusted_rate = exchange_rate * (1.0 - fee_rate);
let weight = -fee_adjusted_rate.ln();

// 2. Bellman-Ford 알고리즘 실행
// 음의 사이클이 존재하면 → 차익거래 기회!
for _ in 0..n-1 {
    for edge in edges {
        if distance[edge.from] + edge.weight < distance[edge.to] {
            distance[edge.to] = distance[edge.from] + edge.weight;
            predecessor[edge.to] = edge.from;
        }
    }
}

// 3. 음의 사이클 확인
for edge in edges {
    if distance[edge.from] + edge.weight < distance[edge.to] {
        // 차익거래 경로 발견!
        let cycle = extract_cycle(predecessor, edge);
        let profit = calculate_profit(cycle);
    }
}
```

#### 경로 추출
```rust
pub fn extract_arbitrage_path(&self, cycle_nodes: Vec<usize>) -> Vec<PathStep> {
    let mut path = Vec::new();

    for i in 0..cycle_nodes.len() - 1 {
        let from = cycle_nodes[i];
        let to = cycle_nodes[i + 1];

        // 최적 엣지 선택 (유동성 및 수수료 고려)
        let best_edge = self.find_best_edge(from, to);

        path.push(PathStep {
            from_token: self.id_to_mint[&from],
            to_token: self.id_to_mint[&to],
            dex: best_edge.dex,
            pool: best_edge.pool,
            expected_rate: (-best_edge.weight).exp(),
        });
    }

    path
}
```

### 3. Enhanced Detector V2 (실시간 감지)

#### Depth-Aware Spread 계산
```rust
pub struct DepthAwareSpread {
    pub spread_pct: f64,          // 가격 차이 (%)
    pub max_volume: f64,          // 최대 거래량
    pub optimal_volume: f64,      // 최적 거래량
    pub expected_profit: f64,     // 예상 수익
    pub confidence: f64,          // 신뢰도 (0.0~1.0)
    pub slippage_buy: f64,        // 매수 슬리피지
    pub slippage_sell: f64,       // 매도 슬리피지
    pub total_fee_rate: f64,      // 총 수수료율
}
```

#### 스프레드 계산 공식
```rust
// 1. 기본 스프레드
let raw_spread = ((sell_price - buy_price) / buy_price) * 100.0;

// 2. 슬리피지 추정
let slippage_buy = estimate_slippage(buy_pool, trade_volume);
let slippage_sell = estimate_slippage(sell_pool, trade_volume);

// 3. 수수료 계산
let total_fee = buy_pool.fee_rate + sell_pool.fee_rate;

// 4. 실제 수익률
let net_spread = raw_spread - slippage_buy - slippage_sell - total_fee;

// 5. 최적 거래량 계산
let optimal_volume = find_optimal_volume(
    buy_pool,
    sell_pool,
    min_profit_threshold,
    max_position_size
);
```

### 4. 수익성 계산

#### 총 비용 구조
```rust
pub struct TradeCost {
    pub gas_fee: f64,              // 트랜잭션 가스비 (~0.00001 SOL)
    pub dex_fees: f64,             // DEX 수수료 (0.25%~1.0%)
    pub jito_tip: f64,             // Jito 번들 팁 (0.0001~0.001 SOL)
    pub slippage: f64,             // 슬리피지 (0.1%~0.5%)
    pub route_cost: f64,           // 멀티홉 추가 비용
}

impl TradeCost {
    pub fn total(&self) -> f64 {
        self.gas_fee + self.dex_fees + self.jito_tip
            + self.slippage + self.route_cost
    }
}
```

#### 실제 수익 계산
```rust
pub fn calculate_net_profit(
    &self,
    opportunity: &ArbitrageOpportunity,
    trade_volume: f64,
) -> f64 {
    // 1. 총 스프레드 수익
    let gross_profit = trade_volume * (opportunity.spread.spread_pct / 100.0);

    // 2. 총 비용
    let costs = TradeCost {
        gas_fee: 0.00001 * SOL_PRICE,
        dex_fees: trade_volume * opportunity.spread.total_fee_rate,
        jito_tip: 0.0005 * SOL_PRICE,
        slippage: trade_volume * (opportunity.spread.slippage_buy
                                 + opportunity.spread.slippage_sell),
        route_cost: 0.0,
    };

    // 3. 실제 수익
    let net_profit = gross_profit - costs.total();

    net_profit
}
```

#### 수익률 임계값
```rust
// 최소 수익률 (기본값)
const MIN_PROFIT_THRESHOLD: f64 = 0.005;  // 0.5%

// 진입 임계값 (더 높은 기준)
const ENTRY_THRESHOLD: f64 = 0.007;       // 0.7%

// 청산 임계값 (더 낮은 기준)
const EXIT_THRESHOLD: f64 = 0.003;        // 0.3%
```

### 5. 실행 타이밍 최적화

#### 기회 우선순위 결정
```rust
pub fn calculate_priority(&self, opp: &ArbitrageOpportunity) -> u8 {
    let mut score = 0u8;

    // 1. 수익률 기준
    if opp.spread.spread_pct > 2.0 { score += 100; }
    else if opp.spread.spread_pct > 1.0 { score += 50; }
    else if opp.spread.spread_pct > 0.5 { score += 25; }

    // 2. 유동성 기준
    if opp.spread.max_volume > 100.0 { score += 30; }
    else if opp.spread.max_volume > 10.0 { score += 15; }

    // 3. 신뢰도 기준
    score += (opp.spread.confidence * 20.0) as u8;

    // 4. 레이턴시 기준 (신선도)
    let age_ms = opp.created_at.elapsed().as_millis();
    if age_ms < 100 { score += 10; }
    else if age_ms < 500 { score += 5; }

    score.min(255)
}
```

#### 실행 워크플로우
```
1. 기회 감지 (Enhanced Detector)
   ↓
2. 유효성 검증 (TTL, 최소 수익률)
   ↓
3. 시뮬레이션 (온체인 검증)
   ↓
4. 번들 생성 (Jito MEV 보호)
   ↓
5. 제출 및 모니터링
```

### 6. DEX별 최적화

#### AMM (Constant Product)
```rust
// Raydium AMM, Raydium CPMM
pub fn calc_amm_output(
    reserve_in: f64,
    reserve_out: f64,
    amount_in: f64,
    fee_rate: f64,
) -> f64 {
    let amount_in_with_fee = amount_in * (1.0 - fee_rate);
    let numerator = amount_in_with_fee * reserve_out;
    let denominator = reserve_in + amount_in_with_fee;
    numerator / denominator
}
```

#### Concentrated Liquidity
```rust
// Raydium CLMM, Orca Whirlpool
pub fn calc_clmm_output(
    sqrt_price: u128,
    liquidity: u128,
    tick_current: i32,
    amount_in: f64,
) -> f64 {
    // Tick array 순회하며 정확한 출력량 계산
    let mut remaining = amount_in;
    let mut output = 0.0;

    for tick in active_ticks {
        let tick_output = swap_within_tick(
            sqrt_price,
            liquidity,
            remaining
        );
        output += tick_output.amount_out;
        remaining = tick_output.remaining;

        if remaining == 0.0 { break; }
    }

    output
}
```

#### Dynamic Liquidity
```rust
// Meteora DLMM
pub fn calc_dlmm_output(
    active_bin_id: i32,
    bin_step: u16,
    amount_in: f64,
) -> f64 {
    // Bin 기반 가격 계산
    let price = (1.0 + (bin_step as f64) / 10000.0)
        .powi(active_bin_id);

    amount_in * price
}
```

## 주요 코드 위치

### 차익거래 엔진
```
src/engine/arbitrage/
├── arbitrage_detector.rs          # 기본 감지기
├── enhanced_detector_v2.rs        # 고급 감지기
├── arbitrage_engine.rs            # 실행 엔진
├── dex_resolver.rs                # DEX별 가격 계산
├── metrics_collector.rs           # 성능 메트릭
└── trade_executor_v3.rs           # 거래 실행기
```

### Bellman-Ford 전략
```
src/strategy/bellman_ford/
├── bellman_ford_arbitrage.rs      # 핵심 알고리즘
├── optimized_graph.rs             # 그래프 구조
├── enhanced_graph.rs              # 향상된 그래프
├── integrated_arbitrage.rs        # 통합 실행
└── monitoring.rs                  # 모니터링
```

## 설정 파라미터

### 환경 변수
```bash
# 최소 수익률 (0.5%)
export MIN_PROFIT_THRESHOLD=0.005

# 최대 포지션 크기 (100 SOL)
export MAX_POSITION_SIZE=100.0

# 최소 유동성 (100 USD)
export MIN_EDGE_LIQUIDITY_USD=100.0

# Cross-DEX 엣지 제한
export MAX_CROSS_DEX_EDGES=12

# TTL (기회 유효시간, 3초)
export OPPORTUNITY_TTL_MS=3000
```

### 런타임 설정
```rust
// config.toml
[arbitrage]
min_profit_threshold = 0.005
max_position_size = 100.0
entry_threshold = 0.007
exit_threshold = 0.003

[graph]
max_cross_dex_edges = 12
max_edges_per_destination = 32
min_edge_liquidity_usd = 100.0
max_triangular_start_nodes = 40
```

## 사용 예시

### 1. Bellman-Ford 그래프 구축
```rust
use crate::strategy::bellman_ford::OptimizedTokenGraph;

let mut graph = OptimizedTokenGraph::new();

// 토큰 추가 (민트 주소 기반)
graph.add_token_with_mint(sol_mint, Some("SOL".to_string()));
graph.add_token_with_mint(usdc_mint, Some("USDC".to_string()));

// 엣지 추가 (풀 정보)
graph.add_edge_with_mints(
    sol_mint,
    usdc_mint,
    Some("SOL".to_string()),
    Some("USDC".to_string()),
    "raydium_amm",
    pool_address,
    price,
    fee_rate,
    liquidity_usd,
    None,
);

// 차익거래 경로 탐색
let opportunities = graph.find_arbitrage_opportunities(
    min_profit_threshold,
    max_path_length,
);
```

### 2. Enhanced Detector 사용
```rust
use crate::engine::arbitrage::EnhancedDetectorV2;

let detector = EnhancedDetectorV2::new();

// 풀 상태 업데이트
detector.update_pool_state(pool_state).await;

// 차익거래 기회 감지
let opportunities = detector.detect_opportunities().await?;

for opp in opportunities {
    if opp.spread.spread_pct > MIN_PROFIT_THRESHOLD * 100.0 {
        println!("Found opportunity: {:.2}% profit", opp.spread.spread_pct);
        println!("  Buy: {} @ {}", opp.buy_pool.dex, opp.buy_pool.price);
        println!("  Sell: {} @ {}", opp.sell_pool.dex, opp.sell_pool.price);
        println!("  Optimal volume: {:.4} SOL", opp.spread.optimal_volume);
    }
}
```

### 3. 수익성 검증
```rust
use crate::engine::arbitrage::calculate_net_profit;

let net_profit = calculate_net_profit(&opportunity, 10.0);

if net_profit > 0.0 {
    println!("Expected net profit: ${:.2}", net_profit);

    // Jito 번들 생성 및 제출
    let bundle = create_arbitrage_bundle(&opportunity, 10.0).await?;
    submit_bundle(bundle).await?;
}
```

## 성능 메트릭

### 목표 성능
- **감지 레이턴시**: < 10ms
- **그래프 업데이트**: < 5ms
- **경로 탐색**: < 50ms (1000 노드 기준)
- **메모리 사용량**: < 500MB

### 실측 성능
- **Bellman-Ford**: ~30ms (500 노드, 2000 엣지)
- **Enhanced Detector**: ~5ms (100 풀 상태)
- **수익성 계산**: < 1ms

## 관련 에이전트
- `arbitrage-analyzer`: 차익거래 기회 상세 분석
- `dex-price-calculation`: DEX별 가격 계산 검증
- `jito-mev-bundle`: MEV 보호 번들 생성

## 제약사항 및 주의사항

### 최소 수익률
- **기본값**: 0.5% (가스비 + 수수료 포함)
- **권장값**: 0.7% (슬리피지 리스크 고려)

### 유동성 제한
- **최소 유동성**: 100 USD (기본값)
- **최대 포지션**: 100 SOL (설정 가능)

### 레이턴시 제한
- **기회 TTL**: 3초 (기본값)
- **감지~실행**: < 100ms 권장

### 리스크 관리
- 슬리피지 추정 필수
- 온체인 시뮬레이션 권장
- Jito 번들 사용으로 MEV 보호

## 디버깅 및 로깅

### 로그 레벨
```bash
# 기회 감지 로그
RUST_LOG=arbitrage_detector=debug

# Bellman-Ford 상세 로그
RUST_LOG=bellman_ford=trace

# 그래프 엣지 거부 추적
export GRAPH_TRACE_REJECTED_EDGES=1
```

### 주요 로그 메시지
```
[INFO] Found negative cycle: SOL -> USDC -> BONK -> SOL (profit: 1.2%)
[DEBUG] Updated graph with 150 edges, 50 nodes
[WARN] Opportunity expired (TTL exceeded): 3500ms
```

## 참고 문서
- [Bellman-Ford Algorithm](https://en.wikipedia.org/wiki/Bellman%E2%80%93Ford_algorithm)
- [Arbitrage Detection in DeFi](https://arxiv.org/abs/2105.02784)
- [MEV Protection with Jito](https://jito.wtf)
