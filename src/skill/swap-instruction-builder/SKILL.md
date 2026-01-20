---
name: swap-instruction-builder
description: "Solana DEX에서 스왑 트랜잭션을 실행하기 위한 명령어(instruction)를 구성하는 스킬. DEX별 프로그램 ID, 계정 구조, CPI 패턴에 맞는 맞춤형 명령어 빌더를 다룹니다."
---

# Swap Instruction Builder Skill

## 개요
Solana DEX에서 스왑 트랜잭션을 실행하기 위한 명령어(instruction)를 구성하는 시스템입니다. 각 DEX는 고유한 프로그램 ID, 계정 구조, CPI 패턴을 가지므로 DEX별 맞춤형 명령어 빌더가 필요합니다.

## 핵심 개념

### 트랜잭션 구조
```
Transaction
  └─ Instruction (1개 이상)
       ├─ program_id: DEX 프로그램 주소
       ├─ accounts: 필요한 계정들 (Vec<AccountMeta>)
       └─ data: 명령어 데이터 (discriminator + args)
```

### 명령어 실행 흐름
1. **Pre-flight**: 계정 상태 조회 및 검증
2. **Build**: 명령어 생성 (program_id, accounts, data)
3. **Simulate**: 트랜잭션 시뮬레이션으로 결과 예측
4. **Sign**: 필요한 서명 수집
5. **Send**: RPC를 통해 트랜잭션 전송
6. **Confirm**: 온체인 확정 대기

## DEX별 스왑 명령어 구조

### 1. Raydium AMM V4

#### 프로그램 정보
```rust
// Program ID
const RAYDIUM_AMM_V4: &str = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

// Instruction discriminators
const SWAP_BASE_IN: u8 = 9;
const SWAP_BASE_OUT: u8 = 10;
```

#### 필수 계정 (17개)
```rust
pub struct RaydiumAmmSwapAccounts {
    // Program accounts
    pub token_program: AccountMeta,           // #0: Token program
    pub amm: AccountMeta,                     // #1: AMM pool state (writable)
    pub amm_authority: AccountMeta,           // #2: AMM authority PDA
    pub amm_open_orders: AccountMeta,         // #3: AMM open orders (writable)
    pub amm_target_orders: AccountMeta,       // #4: AMM target orders (writable)
    pub pool_coin_token_account: AccountMeta, // #5: Pool coin vault (writable)
    pub pool_pc_token_account: AccountMeta,   // #6: Pool PC vault (writable)

    // Serum market accounts
    pub serum_program: AccountMeta,           // #7: Serum DEX program
    pub serum_market: AccountMeta,            // #8: Serum market (writable)
    pub serum_bids: AccountMeta,              // #9: Serum bids (writable)
    pub serum_asks: AccountMeta,              // #10: Serum asks (writable)
    pub serum_event_queue: AccountMeta,       // #11: Serum event queue (writable)
    pub serum_coin_vault: AccountMeta,        // #12: Serum coin vault (writable)
    pub serum_pc_vault: AccountMeta,          // #13: Serum PC vault (writable)
    pub serum_vault_signer: AccountMeta,      // #14: Serum vault signer

    // User accounts
    pub user_source_token: AccountMeta,       // #15: User source token (writable)
    pub user_destination_token: AccountMeta,  // #16: User destination token (writable)
    pub user_owner: AccountMeta,              // #17: User authority (signer)
}
```

#### 명령어 데이터 구조
```rust
// swap_base_in: 입력 토큰 고정
#[repr(C)]
pub struct SwapBaseInData {
    pub instruction: u8,        // 9
    pub amount_in: u64,         // 입력 토큰 수량
    pub minimum_amount_out: u64,// 최소 출력 토큰 수량 (슬리피지 보호)
}

// swap_base_out: 출력 토큰 고정
#[repr(C)]
pub struct SwapBaseOutData {
    pub instruction: u8,        // 10
    pub max_amount_in: u64,     // 최대 입력 토큰 수량
    pub amount_out: u64,        // 원하는 출력 토큰 수량
}
```

#### 명령어 빌더 예시
```rust
pub fn build_raydium_amm_swap(
    pool: &RaydiumAmmPool,
    user: &Pubkey,
    amount_in: u64,
    minimum_amount_out: u64,
) -> Result<Instruction> {
    // Build accounts (17개 순서대로)
    let accounts = vec![
        // Token program, AMM accounts, Serum accounts, User accounts
        // ... (상세 내용은 src/engine/swap/raydium_amm_builder.rs 참조)
    ];

    // Build instruction data
    let mut data = Vec::with_capacity(17);
    data.push(SWAP_BASE_IN);
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&minimum_amount_out.to_le_bytes());

    Ok(Instruction {
        program_id: Pubkey::from_str(RAYDIUM_AMM_V4)?,
        accounts,
        data,
    })
}
```

### 2. Raydium CLMM (Concentrated Liquidity)

#### 프로그램 정보
```rust
const RAYDIUM_CLMM: &str = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";

// Instruction discriminators (Anchor)
const SWAP_DISCRIMINATOR: [u8; 8] = [0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8];
const SWAP_V2_DISCRIMINATOR: [u8; 8] = [0x0d, 0x5e, 0x88, 0xd1, 0x23, 0x4c, 0x9f, 0x3a];
```

#### 필수 계정 (14개)
```rust
pub struct RaydiumClmmSwapAccounts {
    pub payer: AccountMeta,                   // #0: Transaction payer (signer)
    pub amm_config: AccountMeta,              // #1: AMM config
    pub pool_state: AccountMeta,              // #2: Pool state (writable)
    pub input_token_account: AccountMeta,     // #3: User input token (writable)
    pub output_token_account: AccountMeta,    // #4: User output token (writable)
    pub input_vault: AccountMeta,             // #5: Pool input vault (writable)
    pub output_vault: AccountMeta,            // #6: Pool output vault (writable)
    pub observation_state: AccountMeta,       // #7: Observation state (writable)
    pub token_program: AccountMeta,           // #8: Token program
    pub tick_array_0: AccountMeta,            // #9: First tick array (writable)
    pub tick_array_1: AccountMeta,            // #10: Second tick array (writable)
    pub tick_array_2: AccountMeta,            // #11: Third tick array (writable, optional)
    // Optional: oracle account for price reference
}
```

#### Tick Array 선택
```rust
// 현재 틱에 따라 3개의 tick array 선택 (상세 코드는 생략)
pub fn select_tick_arrays(current_tick: i32, tick_spacing: u16, zero_for_one: bool)
    -> (Pubkey, Pubkey, Option<Pubkey>);
```

#### 명령어 데이터 구조
```rust
#[derive(AnchorSerialize)]
pub struct SwapArgs {
    pub amount: u64,               // Input or output amount
    pub other_amount_threshold: u64, // Slippage protection
    pub sqrt_price_limit_x64: u128,  // Price limit (Q64.64 format)
    pub is_base_input: bool,         // true: exact input, false: exact output
}
```

### 3. Raydium CPMM (Constant Product)

#### 프로그램 정보
```rust
const RAYDIUM_CPMM: &str = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";

// Swap discriminator from logs
const SWAP_BASE_INPUT: [u8; 8] = [0x40, 0xc6, 0xcd, 0xe8, 0x26, 0x08, 0x71, 0xe2];
```

#### 필수 계정 (12개)
```rust
pub struct RaydiumCpmmSwapAccounts {
    pub payer: AccountMeta,                   // #0: Transaction payer (signer)
    pub authority: AccountMeta,               // #1: Pool authority PDA
    pub amm_config: AccountMeta,              // #2: AMM config
    pub pool_state: AccountMeta,              // #3: Pool state (writable)
    pub input_token_account: AccountMeta,     // #4: User input token (writable)
    pub output_token_account: AccountMeta,    // #5: User output token (writable)
    pub input_vault: AccountMeta,             // #6: Pool input vault (writable)
    pub output_vault: AccountMeta,            // #7: Pool output vault (writable)
    pub input_token_program: AccountMeta,     // #8: Input token program
    pub output_token_program: AccountMeta,    // #9: Output token program
    pub input_token_mint: AccountMeta,        // #10: Input token mint
    pub output_token_mint: AccountMeta,       // #11: Output token mint
}
```

#### 로그 파싱으로 스왑 결과 확인
```rust
// CPMM은 "Program data:" 형식 로그 사용
pub fn parse_cpmm_swap_log(log: &str) -> Option<SwapResult> {
    if !log.starts_with("Program data: ") {
        return None;
    }

    let data = bs58::decode(&log[14..]).into_vec().ok()?;

    // Check discriminator
    if &data[0..8] != SWAP_BASE_INPUT {
        return None;
    }

    // Parse swap amounts
    let amount_in = u64::from_le_bytes(data[56..64].try_into().ok()?);
    let amount_out = u64::from_le_bytes(data[64..72].try_into().ok()?);
    let direction = data[88]; // 0: A->B, 1: B->A

    Some(SwapResult {
        amount_in,
        amount_out,
        direction,
    })
}
```

### 4. Orca Whirlpool

#### 프로그램 정보
```rust
const ORCA_WHIRLPOOL: &str = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";

// Instruction discriminator
const SWAP_DISCRIMINATOR: [u8; 8] = [0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8];
```

#### 필수 계정 (11개)
```rust
pub struct OrcaWhirlpoolSwapAccounts {
    pub token_program: AccountMeta,           // #0: Token program
    pub token_authority: AccountMeta,         // #1: User authority (signer)
    pub whirlpool: AccountMeta,               // #2: Whirlpool state (writable)
    pub token_owner_account_a: AccountMeta,   // #3: User token A (writable)
    pub token_vault_a: AccountMeta,           // #4: Pool vault A (writable)
    pub token_owner_account_b: AccountMeta,   // #5: User token B (writable)
    pub token_vault_b: AccountMeta,           // #6: Pool vault B (writable)
    pub tick_array_0: AccountMeta,            // #7: First tick array (writable)
    pub tick_array_1: AccountMeta,            // #8: Second tick array (writable)
    pub tick_array_2: AccountMeta,            // #9: Third tick array (writable)
    pub oracle: AccountMeta,                  // #10: Oracle account (writable)
}
```

#### 명령어 데이터 구조
```rust
#[derive(AnchorSerialize)]
pub struct SwapArgs {
    pub amount: u64,               // Input or output amount
    pub other_amount_threshold: u64, // Slippage protection
    pub sqrt_price_limit: u128,      // Price limit (Q64.64 format)
    pub amount_specified_is_input: bool, // true: exact input
    pub a_to_b: bool,                // Swap direction
}
```

### 5. Meteora DLMM

#### 프로그램 정보
```rust
const METEORA_DLMM: &str = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

// Instruction discriminator
const SWAP_DISCRIMINATOR: [u8; 8] = [0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8];
```

#### 필수 계정 (10개)
```rust
pub struct MeteoraSwapAccounts {
    pub lb_pair: AccountMeta,                 // #0: LB pair state (writable)
    pub bin_array_bitmap_extension: AccountMeta, // #1: Bitmap extension
    pub reserve_x: AccountMeta,               // #2: Reserve X vault (writable)
    pub reserve_y: AccountMeta,               // #3: Reserve Y vault (writable)
    pub user_token_in: AccountMeta,           // #4: User input token (writable)
    pub user_token_out: AccountMeta,          // #5: User output token (writable)
    pub token_x_mint: AccountMeta,            // #6: Token X mint
    pub token_y_mint: AccountMeta,            // #7: Token Y mint
    pub oracle: AccountMeta,                  // #8: Oracle account (writable)
    pub host_fee_in: AccountMeta,             // #9: Host fee account (optional)
    pub user: AccountMeta,                    // #10: User authority (signer)
    pub token_x_program: AccountMeta,         // #11: Token X program
    pub token_y_program: AccountMeta,         // #12: Token Y program
    pub event_authority: AccountMeta,         // #13: Event authority
    pub program: AccountMeta,                 // #14: DLMM program
}
```

#### Bin Array 선택
```rust
// Active ID와 스왑 방향에 따라 bin array 선택 (상세 코드는 생략)
pub fn select_bin_arrays(lb_pair: &Pubkey, active_id: i32, swap_for_y: bool) -> Vec<Pubkey>;
```

## CPI (Cross-Program Invocation) 패턴

### Anchor Framework 사용
```rust
pub fn execute_raydium_swap(ctx: Context<ExecuteSwap>, amount_in: u64, min_out: u64) -> Result<()> {
    let cpi_ctx = CpiContext::new(ctx.accounts.dex_program, cpi_accounts);
    raydium_amm::cpi::swap_base_in(cpi_ctx, amount_in, min_out)?;
    Ok(())
}
```

### Native Rust (No Anchor)
```rust
pub fn execute_swap_native(accounts: &[AccountInfo], amount_in: u64, min_out: u64) -> ProgramResult {
    let instruction = build_swap_instruction(...)?;
    invoke_signed(&instruction, accounts, &[&[b"authority", &[bump]]])?;
    Ok(())
}
```

## 시뮬레이션 및 검증

### 트랜잭션 시뮬레이션
```rust
pub async fn simulate_swap(rpc: &RpcClient, tx: &Transaction) -> Result<SimulationResult> {
    let sim = rpc.simulate_transaction(tx)?;
    if let Some(err) = sim.value.err {
        return Err(anyhow!("Simulation failed: {:?}", err));
    }
    let logs = sim.value.logs.unwrap_or_default();
    Ok(parse_swap_logs(&logs)?)
}
```

### 슬리피지 및 가격 영향도 계산
```rust
pub fn calculate_minimum_amount_out(expected: u64, slippage_bps: u16) -> u64 {
    (expected as u128 * (10000 - slippage_bps) as u128 / 10000) as u64
}

pub fn calculate_price_impact(amount_in: u64, amount_out: u64, reserve_in: u64, reserve_out: u64) -> f64 {
    let pool_price = reserve_out as f64 / reserve_in as f64;
    let exec_price = amount_out as f64 / amount_in as f64;
    ((exec_price - pool_price) / pool_price).abs() * 100.0
}
```

## 주요 코드 위치

### 명령어 빌더
- `src/engine/swap/raydium_amm_builder.rs` - Raydium AMM 명령어
- `src/engine/swap/raydium_clmm_builder.rs` - Raydium CLMM 명령어
- `src/engine/swap/raydium_cpmm_builder.rs` - Raydium CPMM 명령어
- `src/engine/swap/orca_builder.rs` - Orca Whirlpool 명령어
- `src/engine/swap/meteora_builder.rs` - Meteora DLMM 명령어

### DEX별 스왑 빌더
- `src/log_subscribers/raydium/swap_builder.rs` - Raydium 통합
- `src/log_subscribers/orca/swap_builder.rs` - Orca 통합
- `src/log_subscribers/meteora/swap_builder.rs` - Meteora 통합

### 공통 유틸리티
- `src/engine/swap/mod.rs` - 스왑 인터페이스 정의
- `src/utils/simulation.rs` - 트랜잭션 시뮬레이션
- `src/utils/slippage.rs` - 슬리피지 계산

## 베스트 프랙티스

### 1. 계정 검증
```rust
// Always verify account ownership
pub fn verify_pool_account(pool: &Account<PoolState>) -> Result<()> {
    require!(
        pool.owner == expected_program_id,
        ErrorCode::InvalidPoolOwner
    );
    Ok(())
}
```

### 2. 슬리피지 보호
```rust
// Never skip slippage protection
let minimum_amount_out = calculate_minimum_amount_out(
    expected_amount,
    MAX_SLIPPAGE_BPS, // e.g., 50 bps = 0.5%
);
```

### 3. 시뮬레이션 우선
```rust
// Always simulate before sending real transaction
let simulation = simulate_swap(&rpc, &transaction).await?;
if simulation.price_impact > 1.0 {
    return Err(anyhow!("Price impact too high: {}%", simulation.price_impact));
}
```

### 4. 로그 파싱
```rust
// Parse logs to verify swap result
let logs = transaction_result.logs.unwrap_or_default();
let actual_amount_out = parse_swap_logs(&logs)?;
assert!(actual_amount_out >= minimum_amount_out);
```

## 관련 에이전트

- **swap-executor**: 스왑 명령어를 실제로 실행하고 결과를 모니터링
- **pool-state-monitor**: 풀 상태를 실시간으로 추적하여 명령어 빌드에 필요한 정보 제공
- **transaction-builder**: 여러 스왑을 하나의 트랜잭션으로 묶는 역할

## 트러블슈팅

### 계정 순서 오류
- **증상**: "InvalidAccountData" 또는 "InvalidInstructionData"
- **원인**: 계정 순서가 프로그램 기대와 다름
- **해결**: 각 DEX의 공식 SDK 참조하여 정확한 순서 확인

### 슬리피지 초과
- **증상**: "SlippageToleranceExceeded"
- **원인**: 시뮬레이션과 실제 실행 사이 가격 변동
- **해결**: 슬리피지 허용치 증가 또는 재시도

### Tick Array 오류 (CLMM)
- **증상**: "TickArrayIndexOutOfBounds"
- **원인**: 잘못된 tick array 선택
- **해결**: `select_tick_arrays()` 로직 재검증

### Bin Array 오류 (DLMM)
- **증상**: "BinArrayNotFound"
- **원인**: Active ID 변경으로 bin array가 변경됨
- **해결**: 최신 상태 조회 후 재빌드
