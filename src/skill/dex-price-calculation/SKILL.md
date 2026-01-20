---
name: dex-price-calculation
description: "Solana DEX들의 다양한 가격 계산 알고리즘을 정확히 구현하고 검증하는 스킬. Raydium, Orca, Meteora, PancakeSwap 등 각 DEX의 고유한 수학적 모델과 정확한 가격 계산을 다룹니다."
---

# DEX 가격 계산 스킬 (DEX Price Calculation Skill)

## 개요
Solana DEX들의 다양한 가격 계산 알고리즘을 정확히 구현하고 검증하는 스킬입니다. 각 DEX는 고유한 수학적 모델을 사용하므로, 정확한 가격 계산은 차익거래 성공의 핵심입니다.

**최종 업데이트**: 2025-11-30
**작성자**: Claude Code
**적용 범위**: 6개 활성 DEX + 3개 개발 중 DEX

## 🎯 DEX별 가격 계산 알고리즘 요약

### 1. Raydium AMM V4 (Constant Product)
**프로그램 ID**: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`

#### 가격 공식
```
price = pc_amount / coin_amount
```
- **x * y = k** (Constant Product Formula)
- Uniswap V2와 동일한 메커니즘

#### 코드 위치
- **파일**: `src/subscribers/raydium_amm/price_calculator.rs`
- **핵심 함수**: `calculate_pool_price(coin_amount, pc_amount)`
- **공식 프로그램 소스(로컬)**: `arbitrage/data/src/raydium-amm/program/src/` (math.rs, processor.rs)

#### 실제 구현 예시
```rust
/// Calculate price from pool reserves
/// Returns: price in PC per COIN
pub fn calculate_pool_price(coin_amount: f64, pc_amount: f64) -> Result<f64> {
    if coin_amount == 0.0 {
        return Err(anyhow::anyhow!("Coin amount is zero"));
    }

    // Pool price: how many PC tokens per 1 COIN token
    Ok(pc_amount / coin_amount)
}

/// Apply decimals to raw amount
pub fn apply_decimals(amount: u64, decimals: u8) -> f64 {
    amount as f64 / 10_f64.powi(decimals as i32)
}
```

#### 주의사항
- **토큰 순서**: coin과 pc 순서가 중요 (API 응답과 계정 데이터 일치 확인)
- **Decimals 보정**: 항상 decimals를 적용한 후 가격 계산
- **수수료**: 0.25% (25 bps) 기본값

---

### 2. Raydium CLMM (Concentrated Liquidity)
**프로그램 ID**: `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`

#### 가격 공식
```
sqrt_price_x64 → price 변환:
1. sqrt_price = sqrt_price_x64 / 2^64
2. price = sqrt_price^2
3. adjusted_price = price * 10^(decimals_0 - decimals_1)
```

또는 tick 기반:
```
price = 1.0001^tick * 10^(decimals_0 - decimals_1)
```

#### 코드 위치
- **파일**: `src/subscribers/raydium_clmm/price_calculator.rs`
- **핵심 함수**: `sqrt_price_x64_to_price()`, `tick_to_price()`
- **공식 프로그램 소스(로컬)**: `arbitrage/data/src/raydium-clmm/programs/amm/src/` (예: `instructions/swap_v2.rs`, `math`)

#### 실제 구현 예시
```rust
/// Convert sqrt_price_x64 to regular price with validation
pub fn sqrt_price_x64_to_price(sqrt_price_x64: u128, decimals_0: u8, decimals_1: u8) -> f64 {
    const TWO_POW_64: u128 = 1u128 << 64;

    // CRITICAL: Check for default/invalid values
    if sqrt_price_x64 == TWO_POW_64 {
        log::warn!("⚠️ Detected default sqrt_price_x64 value (2^64), skipping");
        return 0.0;
    }

    // Calculate price
    let sqrt_price = (sqrt_price_x64 as f64) / (TWO_POW_64 as f64);
    let price = sqrt_price * sqrt_price;

    // Adjust for decimals
    let adjusted_price = price * 10_f64.powi((decimals_0 - decimals_1) as i32);

    adjusted_price
}

/// Calculate price from tick
pub fn tick_to_price(tick: i32, decimals_0: u8, decimals_1: u8) -> f64 {
    let price = 1.0001_f64.powi(tick);
    price * 10_f64.powi((decimals_0 - decimals_1) as i32)
}
```

#### 주의사항
- **sqrt_price_x64 검증**: 기본값 `2^64` 체크 필수
- **유효 범위**: `2^32` ~ `2^96` 사이 값만 유효
- **캐싱**: 동일한 sqrt_price_x64 반복 계산 방지
- **수수료 티어**: 0.01%, 0.05%, 0.3%, 1.0%

---

### 3. Orca Whirlpool (sqrt_price 기반 CLMM)
**프로그램 ID**: `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`

#### 가격 공식
Raydium CLMM과 동일:
```
sqrt_price_x64 → price
```

#### 코드 위치
- **파일**: `src/subscribers/common/price_calculator.rs` (공통 trait)
- **구현**: Raydium CLMM 함수 재사용 가능
- **공식 프로그램 소스(로컬)**: `arbitrage/data/src/orca-whirlpools/programs/whirlpool/src/manager/swap_manager.rs`, `.../state/*`

#### 실제 구현 (Raydium CLMM과 호환)
```rust
// Orca도 동일한 sqrt_price_x64 형식 사용
use crate::subscribers::raydium_clmm::price_calculator::sqrt_price_x64_to_price;

let orca_price = sqrt_price_x64_to_price(
    whirlpool.sqrt_price,
    token_a_decimals,
    token_b_decimals
);
```

#### 검증된 정확도
- **가격 정확도**: 99.8% (2025-08-18 검증)
- **테스트 범위**: SOL $150-$220
- **상태**: ✅ Production Ready

---

### 4. Meteora DLMM (Bin-based Dynamic AMM)
**프로그램 ID**: `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`

#### 가격 공식
```
price = (1 + bin_step/10000)^active_id * 10^(decimals_x - decimals_y)
```

- **bin_step**: 각 bin 간의 가격 간격 (basis points)
- **active_id**: 현재 활성 bin의 ID (양수/음수 가능)

#### 코드 위치
- **파일**: `src/subscribers/meteora_dlmm/price_calculator.rs`
- **핵심 함수**: `calculate_spot_price()`
- **공식 SDK 소스(로컬)**: `arbitrage/data/src/meteora-dlmm-sdk/commons/src/math/price_math.rs`, `.../u64x64_math.rs`

#### 실제 구현 예시
```rust
/// Calculate spot price from active bin ID and bin step
pub fn calculate_spot_price(active_id: i32, bin_step: u16) -> f64 {
    let step_fraction = (bin_step as f64) / 10_000.0;
    (1.0 + step_fraction).powi(active_id)
}

/// Calculate spot price with decimal adjustment
pub fn calculate_spot_price_with_decimals(
    active_id: i32,
    bin_step: u16,
    decimals_x: u8,
    decimals_y: u8,
) -> f64 {
    let raw_price = calculate_spot_price(active_id, bin_step);
    let decimal_adjustment = 10_f64.powi((decimals_x - decimals_y) as i32);
    raw_price * decimal_adjustment
}
```

#### Multi-bin 스왑 시뮬레이션
```rust
/// Simulate swap across multiple bins
fn simulate_swap(
    bin_info: &BinLiquidity,
    amount_in: u64,
    is_x_to_y: bool,
) -> Result<u64> {
    let mut remaining_amount = amount_in;
    let mut total_out = 0u64;
    let mut current_bin_id = bin_info.active_bin_id;

    // Simulate up to 100 bins maximum
    for _ in 0..100 {
        if remaining_amount == 0 {
            break;
        }

        let (consumed, out) = swap_within_bin(bin_info, current_bin_id, remaining_amount)?;
        remaining_amount = remaining_amount.saturating_sub(consumed);
        total_out = total_out.saturating_add(out);

        // Move to next bin
        current_bin_id = if is_x_to_y { current_bin_id - 1 } else { current_bin_id + 1 };
    }

    Ok(total_out)
}
```

#### 주의사항
- **LbPair 오프셋**:
  - `active_id`: offset 76 (i32)
  - `bin_step`: offset 73 (u16)
- **Token2022 제외**: SPL Token만 지원 (캐시 빌드 시 필터링)
- **수수료 계산**: `fee = bin_step / 10000`

---

### 5. PumpFun AMM (Bonding Curve)
**프로그램 ID**: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`

#### 가격 공식
Constant Product (x*y=k) 사용:
```
price = quote_reserves / base_reserves
```

- **토큰 decimals**: 항상 6 (PumpFun 표준)
- **SOL decimals**: 9

#### 코드 위치
- **파일**: `src/subscribers/pumpfun_amm/price_calculator.rs`
- **핵심 함수**: `calculate_price()`, `calculate_swap_output()`

#### 실제 구현 예시
```rust
/// Calculate price from pool reserves
pub fn calculate_price(
    base_reserves: u64,
    quote_reserves: u64,
    base_decimals: u8,
    quote_decimals: u8,
) -> f64 {
    if base_reserves == 0 {
        return 0.0;
    }

    let base_amount = base_reserves as f64 / 10f64.powi(base_decimals as i32);
    let quote_amount = quote_reserves as f64 / 10f64.powi(quote_decimals as i32);

    // Price = quote per base
    quote_amount / base_amount
}

/// Calculate output amount for a given input (constant product formula)
pub fn calculate_swap_output(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_bps: u16,
) -> u64 {
    // Apply fee to input
    let fee_multiplier = 10_000 - fee_bps as u128;
    let amount_in_with_fee = (amount_in as u128 * fee_multiplier) / 10_000;

    // Constant product formula: (x + dx) * (y - dy) = x * y
    // dy = y * dx / (x + dx)
    let numerator = amount_in_with_fee * reserve_out as u128;
    let denominator = reserve_in as u128 + amount_in_with_fee;

    (numerator / denominator) as u64
}
```

#### 특별한 점
- **이벤트에 풀 상태 포함**: Swap 이벤트에 reserves 포함 → Account subscribe 선택사항
- **"Program data:" 파싱**: Base64 디코딩 필요
- **수수료**: 1.0% (100 bps) 고정
- **공식 문서/예제(로컬)**: `arbitrage/data/src/pump-public-docs/`

---

### 6. PancakeSwap V3 (Uniswap V3 Clone)
**프로그램 ID**: `9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP`

#### 가격 공식
Uniswap V3와 동일:
```
sqrtPriceX96 → price 변환:
1. sqrt_price = sqrtPriceX96 / 2^96
2. price = sqrt_price^2
3. adjusted_price = price * 10^(decimals_0 - decimals_1)
```

#### 코드 위치
- **파일**: `src/subscribers/pancakeswap/price_calculator.rs`
- **핵심 함수**: `sqrt_price_x96_to_price()`
- **공식 프로그램 소스(로컬)**: `arbitrage/data/src/pancake-v3-contracts/projects/v3-core/contracts/libraries/TickMath.sol`

#### 실제 구현 예시
```rust
/// Convert sqrtPriceX96 to regular price
pub fn sqrt_price_x96_to_price(sqrt_price_x96: u128, decimals_0: u8, decimals_1: u8) -> f64 {
    const TWO_POW_96: f64 = 79228162514264337593543950336.0; // 2^96

    let sqrt_price = (sqrt_price_x96 as f64) / TWO_POW_96;
    let price = sqrt_price * sqrt_price;

    // Adjust for decimals
    price * 10_f64.powi((decimals_0 - decimals_1) as i32)
}
```

#### 주의사항
- **Q96 형식**: Raydium CLMM의 Q64와 다름 (2^96 vs 2^64)
- **수수료 티어**: 0.01%, 0.05%, 0.25%, 1.0%

---

## 🔧 핵심 변환 공식 정리

### 1. sqrt_price → 실제 가격 변환

#### Q64.64 형식 (Raydium CLMM, Orca)
```rust
const TWO_POW_64: u128 = 1u128 << 64;  // 2^64 = 18,446,744,073,709,551,616

let sqrt_price = (sqrt_price_x64 as f64) / (TWO_POW_64 as f64);
let price = sqrt_price * sqrt_price;
let adjusted_price = price * 10_f64.powi((decimals_0 - decimals_1) as i32);
```

#### Q96 형식 (PancakeSwap V3)
```rust
const TWO_POW_96: f64 = 79228162514264337593543950336.0;  // 2^96

let sqrt_price = (sqrt_price_x96 as f64) / TWO_POW_96;
let price = sqrt_price * sqrt_price;
let adjusted_price = price * 10_f64.powi((decimals_0 - decimals_1) as i32);
```

### 2. Tick → 가격 변환 (CLMM)
```rust
pub fn tick_to_price(tick: i32, decimals_0: u8, decimals_1: u8) -> f64 {
    let price = 1.0001_f64.powi(tick);
    price * 10_f64.powi((decimals_0 - decimals_1) as i32)
}
```

### 3. Bin → 가격 변환 (DLMM)
```rust
pub fn bin_to_price(bin_id: i32, bin_step: u16, decimals_x: u8, decimals_y: u8) -> f64 {
    let step_fraction = (bin_step as f64) / 10_000.0;
    let price = (1.0 + step_fraction).powi(bin_id);
    price * 10_f64.powi((decimals_x - decimals_y) as i32)
}
```

---

## 💰 수수료 계산 및 적용

### DEX별 수수료율

| DEX | 수수료 티어 | 저장 형식 | 계산 방법 |
|-----|-----------|----------|----------|
| **Raydium AMM** | 0.25% 고정 | bps (25) | `fee = amount * 25 / 10000` |
| **Raydium CLMM** | 0.01%~1.0% | bps | Pool 설정에서 조회 |
| **Orca Whirlpool** | 0.01%~1.0% | bps | Pool 설정에서 조회 |
| **Meteora DLMM** | bin_step/10000 | bin_step | `fee = amount * bin_step / 10000` |
| **PumpFun AMM** | 1.0% 고정 | bps (100) | `fee = amount * 100 / 10000` |
| **PancakeSwap** | 0.01%~1.0% | bps | Pool 설정에서 조회 |

### 수수료 적용 순서 (중요!)

#### 올바른 순서
```rust
// 1. 입력 금액에서 수수료 차감
let fee = (amount_in as u128 * fee_bps as u128) / 10_000;
let amount_in_after_fee = amount_in - fee;

// 2. 수수료 제외된 금액으로 스왑 계산
let amount_out = calculate_swap(amount_in_after_fee, reserves_in, reserves_out);
```

#### 잘못된 순서
```rust
// ❌ 스왑 계산 후 수수료 차감은 잘못됨
let amount_out_gross = calculate_swap(amount_in, reserves_in, reserves_out);
let fee = (amount_out_gross * fee_bps) / 10_000;
let amount_out_net = amount_out_gross - fee;  // 잘못된 방법
```

---

## 🔍 트러블슈팅: 가격 오차 원인 및 해결

### 일반적인 오차 원인

#### 1. Decimals 미적용
**증상**: 가격이 1000배 또는 0.001배 차이
```rust
// ❌ 잘못된 코드
let price = pc_amount / coin_amount;

// ✅ 올바른 코드
let coin_adj = coin_amount as f64 / 10_f64.powi(coin_decimals as i32);
let pc_adj = pc_amount as f64 / 10_f64.powi(pc_decimals as i32);
let price = pc_adj / coin_adj;
```

#### 2. sqrt_price 기본값 미검증
**증상**: 가격이 1.0으로 고정
```rust
// ✅ 기본값 체크 필수
const TWO_POW_64: u128 = 1u128 << 64;
if sqrt_price_x64 == TWO_POW_64 {
    return 0.0;  // Skip default value
}
```

#### 3. 토큰 순서 뒤바뀜
**증상**: 가격이 역수로 계산됨 (예: 0.005 vs 200)
```rust
// ✅ 토큰 민트 주소로 순서 확인
if token_a_mint == EXPECTED_BASE_MINT {
    price = reserve_b / reserve_a;
} else {
    price = reserve_a / reserve_b;
}
```

#### 4. 수수료 적용 누락
**증상**: 실제 스왑 결과와 10% 이상 차이
```rust
// ✅ 수수료 먼저 적용
let amount_in_with_fee = (amount_in as u128 * (10_000 - fee_bps as u128)) / 10_000;
let amount_out = calculate_swap(amount_in_with_fee, ...);
```

### 디버깅 체크리스트
- [ ] Decimals 정확히 적용했는가?
- [ ] sqrt_price 기본값 (2^64 또는 2^96) 체크했는가?
- [ ] 토큰 순서가 올바른가?
- [ ] 수수료를 입력 금액에 먼저 적용했는가?
- [ ] 온체인 데이터와 비교 검증했는가?

---

## 📚 관련 DEX 전문가 에이전트

각 DEX별 상세 구현은 전문 에이전트에게 문의하세요:

- **Raydium AMM**: `src/subscribers/raydium_amm/CLAUDE.md`
- **Raydium CLMM**: `src/subscribers/backup/raydium_clmm/CLAUDE.md`
- **Orca Whirlpool**: `src/subscribers/backup/orca_whirlpool/CLAUDE.md`
- **Meteora DLMM**: `src/subscribers/backup/meteora_dlmm/CLAUDE.md`
- **PumpFun AMM**: `src/subscribers/pumpfun_amm/CLAUDE.md`
- **PancakeSwap V3**: `src/subscribers/pancakeswap/CLAUDE.md`

---

## 🧪 테스트 및 검증

### 단위 테스트 실행
```bash
# 모든 DEX 가격 계산 테스트
cargo test --features extended-tests -- price_calculator

# 특정 DEX만 테스트
cargo test --features extended-tests raydium_amm::price_calculator
cargo test --features extended-tests raydium_clmm::price_calculator
```

### 온체인 검증
```bash
# Dry run으로 실제 가격과 비교
cargo run --release --bin arbitrage -- --dry-run

# 로그에서 가격 오차 확인
grep "Price.*diff" logs/arbitrage_*.log
```

### 가격 정확도 목표
- **Excellent**: < 1% 오차
- **Good**: 1-5% 오차
- **Poor**: > 5% 오차 (수정 필요!)

---

## 📖 참고 자료

### 공식 SDK
- [Raydium AMM SDK](https://github.com/raydium-io/raydium-amm)
- [Raydium CLMM SDK](https://github.com/raydium-io/raydium-clmm)
- [Orca SDK](https://github.com/orca-so/whirlpool-sdk)
- [Meteora DLMM SDK](https://github.com/MeteoraAg/dlmm-sdk)

### 내부 문서
- [Price Calculation Tests](../../docs/20250818/price_calculation_tests.md)
- [Cross-DEX Price Comparison](../../docs/20250822/052100_dex_price_spread_analysis.md)

---

*최종 업데이트: 2025-11-30*
*버전: 1.0*
*작성자: Claude Code*
