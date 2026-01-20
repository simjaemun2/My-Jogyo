---
name: dex-idl-parsing
description: "Solana DEX의 온체인 계정 구조를 파싱하고 Borsh 역직렬화를 수행하는 스킬. 각 DEX의 고유한 계정 레이아웃과 데이터 구조, Discriminator 처리, 오프셋 계산을 다룹니다."
---

# DEX IDL Parsing Skill

## 개요
Solana DEX의 온체인 계정 구조를 파싱하고 Borsh 역직렬화를 수행하는 전문 skill입니다. 각 DEX는 고유한 계정 레이아웃과 데이터 구조를 가지며, 정확한 파싱은 실시간 가격 계산과 차익거래 기회 포착에 필수적입니다.

## 핵심 역량
- **Borsh 역직렬화**: Anchor 프레임워크 기반 계정 데이터 파싱
- **Discriminator 처리**: 8바이트 계정 식별자 검증
- **오프셋 계산**: 구조체 필드별 바이트 위치 정확히 파악
- **에러 복구**: 파싱 실패 시 graceful degradation

## 로컬 IDL/캐시 경로 현황 (2025-12-10)
- **PancakeSwap V3**  
  - IDL 스냅샷: `arbitrage/src/subscribers/pancakeswap/idl.json`  
  - IDL 백업: `arbitrage/src/subscribers/pancakeswap/docs/idl.json`  
  - IDL 캐시: `arbitrage/data/cache/pancakeswap/pancakeswap_idl_cache.json`
- **Raydium (AMM/CLMM/CPMM)**  
  - GitHub IDL 복제본: `arbitrage/data/idl/raydium-idl/`  
    - AMM: `arbitrage/data/idl/raydium-idl/raydium_amm/idl.json`  
    - CLMM: `arbitrage/data/idl/raydium-idl/raydium_clmm/amm_v3.json`  
    - CPMM: `arbitrage/data/idl/raydium-idl/raydium_cpmm/raydium_cp_swap.json`
- **Orca Whirlpool**  
  - IDL 스냅샷: `arbitrage/data/idl/orca/whirlpool.json`
- **Meteora DLMM**  
  - IDL 스냅샷: `arbitrage/data/idl/meteora/dlmm.json`
- **Meteora DAMM V2**  
  - IDL 스냅샷: `arbitrage/data/idl/damm_v2_idl.json`
- **기타**  
  - PumpFun AMM: 로컬 IDL 미보유 → 공개 repo에서 fetch 필요

## DEX별 계정 구조

### 1. Raydium AMM V4 (Program: 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8)

#### AmmInfo 구조체 (752 bytes)
```rust
#[derive(BorshDeserialize, Debug, Clone)]
pub struct AmmInfo {
    // Pool state (0-128)
    pub status: u64,                    // 0-8
    pub nonce: u64,                     // 8-16
    pub coin_decimals: u64,             // 32-40: Base token decimals
    pub pc_decimals: u64,               // 40-48: Quote token decimals

    // Fees (128-208)
    pub trade_fee_numerator: u64,       // 144-152
    pub trade_fee_denominator: u64,     // 152-160

    // Reserves (208-272) - Critical for price calculation
    pub pool_total_deposit_pc: u128,    // 224-240
    pub pool_total_deposit_coin: u128,  // 240-256
    pub swap_coin_in_amount: u128,      // 256-272
    pub swap_pc_out_amount: u128,       // 272-288

    // ... 25+ additional fields (see types.rs for full definition)
}
```

**파싱 예시**:
```rust
use borsh::BorshDeserialize;

pub fn parse_raydium_amm_pool(data: &[u8]) -> Result<AmmInfo, Box<dyn std::error::Error>> {
    if data.len() < 752 {
        return Err("Insufficient data length".into());
    }

    // Skip 8-byte discriminator
    let pool = AmmInfo::try_from_slice(&data[8..])?;

    Ok(pool)
}
```

**주요 오프셋**:
- `coin_decimals`: 32
- `pc_decimals`: 40
- `trade_fee_numerator`: 144
- `trade_fee_denominator`: 152
- `swap_coin_in_amount`: 256
- `swap_pc_out_amount`: 272

### 2. Raydium CLMM (Program: CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK)

#### PoolState 구조체
```rust
#[derive(BorshDeserialize, Debug, Clone)]
pub struct PoolState {
    // Account addresses (0-225)
    pub bump: [u8; 1],                  // 0-1
    pub amm_config: Pubkey,             // 1-33
    pub token_mint_0: Pubkey,           // 65-97
    pub token_mint_1: Pubkey,           // 97-129

    // Decimals (225-229)
    pub mint_decimals_0: u8,            // 225
    pub mint_decimals_1: u8,            // 226

    // Price data (227-265) - Critical
    pub tick_spacing: u16,              // 227-229
    pub liquidity: u128,                // 229-245
    pub sqrt_price_x64: u128,           // 245-261: Current price
    pub tick_current: i32,              // 261-265

    // Status (381)
    pub status: u8,                     // 0=Initialized, 1=Disabled

    // ... additional fields: fee growth, protocol fees, rewards (see clmm_types.rs)
}
```

**파싱 예시**:
```rust
pub fn parse_raydium_clmm_pool(data: &[u8]) -> Result<PoolState, Box<dyn std::error::Error>> {
    if data.len() < 653 {
        return Err("Insufficient data length for CLMM pool".into());
    }

    // Skip 8-byte discriminator
    let pool = PoolState::try_from_slice(&data[8..])?;

    // Validate status
    if pool.status > 1 {
        return Err(format!("Invalid pool status: {}", pool.status).into());
    }

    Ok(pool)
}
```

**주요 오프셋**:
- `token_mint_0`: 65
- `token_mint_1`: 97
- `mint_decimals_0`: 225
- `mint_decimals_1`: 226
- `tick_spacing`: 227
- `liquidity`: 229
- `sqrt_price_x64`: 245
- `tick_current`: 261
- `status`: 381

### 3. Raydium CPMM (Program: CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C)

#### CpmmPoolState 구조체 (904 bytes)
```rust
#[derive(BorshDeserialize, Debug, Clone)]
pub struct CpmmPoolState {
    // Addresses (0-225)
    pub bump: [u8; 1],                  // 0-1
    pub token_0_mint: Pubkey,           // 65-97
    pub token_1_mint: Pubkey,           // 97-129

    // Status & Decimals (225-230)
    pub status: u8,                     // 226
    pub mint_0_decimals: u8,            // 228
    pub mint_1_decimals: u8,            // 229

    // LP & Fees (230-278)
    pub lp_supply: u64,                 // 230-238
    pub open_time: u64,                 // 270-278

    // ... additional fields (see cpmm_types.rs)
}
```

**파싱 예시**:
```rust
pub fn parse_raydium_cpmm_pool(data: &[u8]) -> Result<CpmmPoolState, Box<dyn std::error::Error>> {
    // CPMM uses 8-byte discriminator: [247, 60, 139, 161, 198, 157, 23, 195]
    if data.len() < 904 {
        return Err("Insufficient data length for CPMM pool".into());
    }

    let pool = CpmmPoolState::try_from_slice(&data[8..])?;

    // Validate decimals
    if pool.mint_0_decimals > 18 || pool.mint_1_decimals > 18 {
        return Err("Invalid token decimals".into());
    }

    Ok(pool)
}
```

**주요 오프셋**:
- `token_0_mint`: 65
- `token_1_mint`: 97
- `mint_0_decimals`: 228
- `mint_1_decimals`: 229
- `lp_supply`: 230
- `open_time`: 270

### 4. Orca Whirlpool (Program: whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc)

#### Whirlpool 구조체
```rust
#[derive(BorshDeserialize, Debug, Clone)]
pub struct Whirlpool {
    // Config (0-41)
    pub whirlpools_config: Pubkey,      // 0-32
    pub tick_spacing: u16,              // 33-35
    pub fee_rate: u16,                  // 37-39: Fee rate (bps)

    // Price data (41-77) - Critical
    pub liquidity: u128,                // 41-57
    pub sqrt_price: u128,               // 57-73: X64 format
    pub tick_current_index: i32,        // 73-77

    // Token info (93-237)
    pub token_mint_a: Pubkey,           // 93-125
    pub token_mint_b: Pubkey,           // 173-205

    // ... additional fields: vaults, fee growth, rewards (see types.rs)
}
```

**파싱 예시**:
```rust
pub fn parse_orca_whirlpool(data: &[u8]) -> Result<Whirlpool, Box<dyn std::error::Error>> {
    if data.len() < 653 {
        return Err("Insufficient data length for Whirlpool".into());
    }

    // Orca also uses 8-byte discriminator
    let pool = Whirlpool::try_from_slice(&data[8..])?;

    // Validate fee rate (0-10000 bps = 0-100%)
    if pool.fee_rate > 10000 {
        return Err(format!("Invalid fee rate: {}", pool.fee_rate).into());
    }

    Ok(pool)
}
```

**주요 오프셋**:
- `tick_spacing`: 33
- `fee_rate`: 37
- `liquidity`: 41
- `sqrt_price`: 57
- `tick_current_index`: 73
- `token_mint_a`: 93
- `token_mint_b`: 173

### 5. Meteora DLMM (Program: LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo)

#### LbPair 구조체 (904 bytes)
```rust
#[derive(BorshDeserialize, Debug, Clone)]
pub struct LbPair {
    pub parameters: StaticParameters,   // 0-120
    pub v_parameters: VariableParameters, // 120-152

    // Price info (153-160) - Critical
    pub bin_step: u16,                  // 153-155: Price step (bps)
    pub active_id: i32,                 // 156-160: Current bin

    // Token info (194-322)
    pub reserve_x: Pubkey,              // 194-226
    pub reserve_y: Pubkey,              // 226-258
    pub token_x_mint: Pubkey,           // 258-290
    pub token_y_mint: Pubkey,           // 290-322

    // ... additional fields: fees, rewards (see types.rs)
}
```

**파싱 예시**:
```rust
pub fn parse_meteora_dlmm_pool(data: &[u8]) -> Result<LbPair, Box<dyn std::error::Error>> {
    if data.len() < 904 {
        return Err("Insufficient data length for DLMM pool".into());
    }

    // Skip 8-byte discriminator
    let pool = LbPair::try_from_slice(&data[8..])?;

    // Validate bin_step (1-500 bps typical)
    if pool.bin_step == 0 || pool.bin_step > 500 {
        return Err(format!("Invalid bin_step: {}", pool.bin_step).into());
    }

    Ok(pool)
}
```

**주요 오프셋**:
- `bin_step`: 153
- `active_id`: 156
- `token_x_mint`: 258
- `token_y_mint`: 290
- `reserve_x`: 194
- `reserve_y`: 226

## Borsh 역직렬화 패턴

### 기본 패턴
```rust
use borsh::BorshDeserialize;

// 1. 구조체 정의 with BorshDeserialize derive
#[derive(BorshDeserialize, Debug)]
pub struct MyStruct {
    pub field1: u64,
    pub field2: Pubkey,
}

// 2. 파싱 함수
pub fn parse_account(data: &[u8]) -> Result<MyStruct, std::io::Error> {
    // Skip discriminator (first 8 bytes for Anchor accounts)
    MyStruct::try_from_slice(&data[8..])
}
```

### Discriminator 검증
```rust
pub const EXPECTED_DISCRIMINATOR: [u8; 8] = [247, 60, 139, 161, 198, 157, 23, 195];

pub fn parse_with_discriminator_check(data: &[u8]) -> Result<MyStruct, Box<dyn Error>> {
    if data.len() < 8 {
        return Err("Data too short".into());
    }

    let discriminator = &data[0..8];
    if discriminator != EXPECTED_DISCRIMINATOR {
        return Err("Invalid discriminator".into());
    }

    MyStruct::try_from_slice(&data[8..])
}
```

### Nested 구조체 처리
```rust
#[derive(BorshDeserialize, Debug)]
pub struct Parent {
    pub child: Child,
    pub values: [u64; 10],
}

#[derive(BorshDeserialize, Debug)]
pub struct Child {
    pub name: String,
    pub amount: u128,
}

// Borsh가 자동으로 재귀적 역직렬화 수행
let parent = Parent::try_from_slice(&data[8..])?;
```

## 주요 코드 위치

### Raydium
- **AMM Types**: `src/log_subscribers/raydium/types.rs`
- **AMM Parser**: `src/log_subscribers/raydium/parser.rs`
- **CLMM Types**: `src/log_subscribers/raydium/clmm_types.rs`
- **CPMM Types**: `src/log_subscribers/raydium/cpmm_types.rs`

### Orca
- **Whirlpool Types**: `src/log_subscribers/orca/types.rs`
- **Whirlpool Parser**: `src/log_subscribers/orca/parser.rs`

### Meteora
- **DLMM Types**: `src/log_subscribers/meteora/types.rs`
- **DLMM Parser**: `src/log_subscribers/meteora/parser.rs`
- **State PDA Derivation**: `src/log_subscribers/meteora/state_tracker.rs`

## 트러블슈팅

### 1. "Insufficient data length" 에러
**원인**: 계정 데이터 크기가 예상보다 작음
```rust
// 해결: 최소 크기 검증
if data.len() < MINIMUM_SIZE {
    return Err(format!("Expected at least {} bytes, got {}", MINIMUM_SIZE, data.len()).into());
}
```

### 2. Borsh 역직렬화 실패
**원인**: 구조체 정의가 실제 계정 레이아웃과 불일치
```rust
// 디버깅: 바이트 배열 출력
println!("First 100 bytes: {:?}", &data[..100.min(data.len())]);

// 해결: IDL 재확인 또는 온체인 계정 검증
solana account <ACCOUNT_PUBKEY> -ul --output json
```

### 3. Discriminator 불일치
**원인**: 잘못된 계정 타입 또는 프로그램
```rust
// 해결: 실제 discriminator 출력
let actual_discriminator = &data[0..8];
println!("Actual discriminator: {:?}", actual_discriminator);

// Anchor discriminator는 SHA256("account:AccountName")[0..8]
use sha2::{Sha256, Digest};
let hash = Sha256::digest(b"account:MyAccount");
let expected = &hash[0..8];
```

### 4. 패딩 필드 무시
**원인**: 구조체 정렬을 위한 패딩이 포함됨
```rust
#[derive(BorshDeserialize)]
pub struct MyStruct {
    pub field1: u8,
    pub padding: [u8; 7],  // Alignment padding
    pub field2: u64,       // Needs 8-byte alignment
}
```

### 5. AccountNotFound 에러
**원인**: 로컬 validator에 계정이 인덱싱되지 않음
```rust
// 해결: Dual RPC client로 fallback
match local_client.get_account(&pubkey) {
    Ok(account) => parse_account(&account.data),
    Err(_) => {
        // Fallback to mainnet RPC
        mainnet_client.get_account(&pubkey)
            .and_then(|account| parse_account(&account.data))
    }
}
```

## 관련 에이전트
- **Raydium AMM Expert**: AMM V4 풀 파싱 전문
- **Raydium CLMM Expert**: 집중 유동성 풀 파싱 전문
- **Orca Expert**: Whirlpool 구조 파싱 전문
- **Meteora Expert**: DLMM bin 기반 파싱 전문

## 베스트 프랙티스

### 1. 타입 안전성
```rust
// ✅ 강타입 사용
pub struct TokenAmount {
    pub raw: u64,
    pub decimals: u8,
}

impl TokenAmount {
    pub fn to_ui_amount(&self) -> f64 {
        self.raw as f64 / 10_u64.pow(self.decimals as u32) as f64
    }
}

// ❌ 원시 타입 직접 사용
let amount: u64 = 1_000_000;
```

### 2. 에러 처리
```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ParseError {
    #[error("Insufficient data: expected {expected}, got {actual}")]
    InsufficientData { expected: usize, actual: usize },

    #[error("Invalid discriminator: {0:?}")]
    InvalidDiscriminator([u8; 8]),

    #[error("Borsh deserialization failed: {0}")]
    BorshError(#[from] std::io::Error),
}
```

### 3. 구조체 검증
```rust
impl PoolState {
    pub fn validate(&self) -> Result<(), ParseError> {
        if self.status > 1 {
            return Err(ParseError::InvalidStatus(self.status));
        }

        if self.liquidity == 0 {
            return Err(ParseError::ZeroLiquidity);
        }

        Ok(())
    }
}
```

### 4. 성능 최적화
```rust
// ✅ 참조 전달로 복사 최소화
pub fn parse_pool(data: &[u8]) -> Result<PoolState, ParseError> {
    PoolState::try_from_slice(&data[8..])
}

// ❌ 불필요한 복사
pub fn parse_pool_bad(data: Vec<u8>) -> Result<PoolState, ParseError> {
    PoolState::try_from_slice(&data[8..])
}
```

## 요약
DEX 계정 파싱은 MEV 봇의 핵심 기능입니다. Borsh 역직렬화를 정확히 수행하고, 각 DEX의 고유한 계정 구조를 이해하며, 에러를 gracefully 처리하는 것이 성공적인 차익거래 시스템의 기반입니다.
