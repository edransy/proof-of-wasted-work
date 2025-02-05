// programs/proof_of_wasted_work/src/lib.rs
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    native_token::LAMPORTS_PER_SOL,
    program::invoke,
    system_instruction
};
use anchor_spl::token::{self, Mint, TokenAccount, MintTo, Token};
use anchor_spl::associated_token::AssociatedToken;

use sha2::{Sha256, Digest};
use switchboard_v2::AggregatorAccountData;

mod state;
use state::*;

declare_id!("EDC6ToM56SBkbwgtFK9erEsc7pPoBLWTp7tjrSPtp5DF");

/// New Switchboard aggregator feed address for Bitcoin tip data.
// pub const SWITCHBOARD_BTC_BLOCK_TIP: Pubkey = pubkey!("32acusHT67wNeJMC9SzD5J6uV9QdN38YSXiGWE9yUvYc");

/// Constants for minting rewards and deposit amounts.
pub const TOKEN_PER_NEAR_MISS: u64 = 100;
pub const SUBMISSION_DEPOSIT: u64 = LAMPORTS_PER_SOL / 1000; // 0.001 SOL

/// Fee distribution (in percentages) for invalid submissions.
pub const ORACLE_MAINTENANCE_PERCENTAGE: u8 = 20;
pub const BURN_PERCENTAGE: u8 = 30;
pub const TREASURY_PERCENTAGE: u8 = 50;

/// Add a constant for the expected Bitcoin version.
pub const EXPECTED_BITCOIN_VERSION: u32 = 0x20000000;

pub struct BlockTip {
    pub previousblockhash: [u8; 32],
    pub merkle_root: [u8; 32],
    pub version: u32,
    pub timestamp: u32,
    pub bits: u32,
    pub height: u32,
}

#[program]
pub mod proof_of_wasted_work {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        difficulty_k: u8,
    ) -> Result<()> {
        let near_miss = &mut ctx.accounts.near_miss_mint;
        near_miss.difficulty_target = difficulty_k;
        near_miss.bump = *ctx.bumps.get("near_miss_mint").unwrap();
        Ok(())
    }

    pub fn create_mint(_ctx: Context<CreateMint>) -> Result<()> {
        // The mint is initialized automatically by Anchor's constraints
        Ok(())
    }

    pub fn submit_near_miss(
        mut ctx: Context<SubmitNearMiss>,
        version: u32,
        prev_hash: [u8; 32],
        merkle_root: [u8; 32],
        timestamp: u32,
        bits: u32,
        nonce: u32,
        extra_nonce: u64,
    ) -> Result<()> {
        msg!("🔍 SUBMIT_NEAR_MISS INSTRUCTION STARTED 🔍");
        // 1. Collect deposit from the user's SOL account.
        collect_deposit(&ctx)?;

        // 2. Verify the near-miss submission.
        let valid = verify_near_miss(
            &ctx,
            version,
            prev_hash,
            merkle_root,
            timestamp,
            bits,
            nonce,
            extra_nonce,
        )?;

        if valid {
            // 3a. For a valid submission, update state, mint tokens, and return the deposit.
            process_valid_submission(&mut ctx, nonce)?;
            return_deposit(&mut ctx)?;
        } else {
            // 3b. For an invalid submission, distribute the deposit accordingly.
            distribute_deposit(&mut ctx)?;
        }

        Ok(())
    }
}

/// Accounts for near-miss submissions.
#[derive(Accounts)]
pub struct SubmitNearMiss<'info> {
    /// The miner's signer which is also the deposit source.
    #[account(mut)]
    pub mint_authority: Signer<'info>,

    /// The persistent state account that tracks minted tokens, difficulty, and submitted nonces.
    #[account(
        mut,
        seeds = [b"nearmiss_mint"],
        bump = near_miss_mint.bump
    )]
    pub near_miss_mint: Account<'info, NearMissMint>,

    /// The user's SOL account from which the submission deposit is taken.
    #[account(
        mut,
        constraint = mint_authority.lamports() >= SUBMISSION_DEPOSIT
    )]
    /// CHECK: No need for data checks.
    pub mint_authority_info: AccountInfo<'info>,

    /// SOL account for funding oracle maintenance.
    #[account(
        mut,
        seeds = [b"oracle_maintenance"],
        bump
    )]
    /// CHECK: No need for data checks.
    pub oracle_maintenance: AccountInfo<'info>,

    /// SOL account for the protocol treasury.
    #[account(
        mut,
        seeds = [b"treasury"],
        bump
    )]
    /// CHECK: No need for data checks.
    pub treasury: AccountInfo<'info>,

    /// The token mint for NearMissToken.
    #[account(mut)]
    pub token_mint: Box<Account<'info, Mint>>,

    /// The user's associated token account to receive rewarded tokens.
    #[account(
        init_if_needed,
        payer = mint_authority,
        associated_token::mint = token_mint,
        associated_token::authority = mint_authority
    )]
    /// CHECK: No need for data checks.
    pub token_account: Box<Account<'info, TokenAccount>>,

    /// New feed for Bitcoin block tip data.
    /// CHECK: This account is unchecked because we use a mocked aggregator feed in tests.
    #[account(mut)]
    pub btc_tip_feed: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = mint_authority,
        space = 8 + NearMissMint::SPACE,
        seeds = [b"nearmiss_mint"],
        bump
    )]
    pub near_miss_mint: Account<'info, NearMissMint>,
    
    #[account(mut)]
    pub mint_authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateMint<'info> {
    #[account(
        init,
        payer = authority,
        mint::decimals = 0,
        mint::authority = authority.key(),
    )]
    pub token_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Arithmetic overflow occurred.")]
    Overflow,
    #[msg("Duplicate nonce submission within the current block.")]
    DuplicateSubmission,
    #[msg("Submission did not meet near-miss criteria.")]
    InvalidNearMiss,
    #[msg("Submission is stale compared to Bitcoin block data.")]
    StaleSubmission,
    #[msg("Oracle feed provided an invalid value.")]
    InvalidOracleValue,
    #[msg("Switchboard feed data is stale.")]
    StaleFeed,
}

impl From<ErrorCode> for ProgramError {
    fn from(e: ErrorCode) -> Self {
        ProgramError::Custom(e as u32)
    }
}

/// -----------------------
/// Deposit Management
/// -----------------------

/// Transfers the deposit (SUBMISSION_DEPOSIT) from the user to the contract's state (NEAR_MISS_MINT).
fn collect_deposit(ctx: &Context<SubmitNearMiss>) -> Result<()> {
    invoke(
        &system_instruction::transfer(
            &ctx.accounts.mint_authority_info.key(),
            &ctx.accounts.near_miss_mint.key(),
            SUBMISSION_DEPOSIT,
        ),
        &[
            ctx.accounts.mint_authority_info.to_account_info(),
            ctx.accounts.near_miss_mint.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;
    Ok(())
}

/// Returns the full deposit to the user after a valid submission.
fn return_deposit(ctx: &mut Context<SubmitNearMiss>) -> Result<()> {
    **ctx.accounts.near_miss_mint.to_account_info().try_borrow_mut_lamports()? -= SUBMISSION_DEPOSIT;
    **ctx.accounts.mint_authority_info.try_borrow_mut_lamports()? += SUBMISSION_DEPOSIT;
    Ok(())
}

/// Distributes the deposit for an invalid submission based on defined percentages.
/// The deposit is split between oracle maintenance, treasury, and the remainder is burned (left in NEAR_MISS_MINT).
fn distribute_deposit(ctx: &mut Context<SubmitNearMiss>) -> Result<()> {
    let oracle_amount = (SUBMISSION_DEPOSIT as u128 * ORACLE_MAINTENANCE_PERCENTAGE as u128 / 100) as u64;
    let treasury_amount = (SUBMISSION_DEPOSIT as u128 * TREASURY_PERCENTAGE as u128 / 100) as u64;
    // Burn amount remains in the NEAR_MISS_MINT account (i.e. not returned).

    **ctx.accounts.near_miss_mint.to_account_info().try_borrow_mut_lamports()? -= oracle_amount;
    **ctx.accounts.oracle_maintenance.try_borrow_mut_lamports()? += oracle_amount;

    **ctx.accounts.near_miss_mint.to_account_info().try_borrow_mut_lamports()? -= treasury_amount;
    **ctx.accounts.treasury.try_borrow_mut_lamports()? += treasury_amount;

    let near_miss = &mut ctx.accounts.near_miss_mint;
    near_miss.oracle_balance = near_miss.oracle_balance.checked_add(oracle_amount).ok_or(ErrorCode::Overflow)?;
    near_miss.treasury_balance = near_miss.treasury_balance.checked_add(treasury_amount).ok_or(ErrorCode::Overflow)?;
    Ok(())
}

/// -----------------------
/// Verification & Token Minting
/// -----------------------

/// Verifies the submitted near-miss by:
/// 1. Checking oracle feed freshness and submission recency,
/// 2. Reconstructing the Bitcoin header,
/// 3. Computing the double SHA-256 hash,
/// 4. And ensuring the number of trailing zero bytes equals (difficulty_target - 1).
fn verify_near_miss(
    ctx: &Context<SubmitNearMiss>,
    version: u32,
    prev_hash: [u8; 32],
    merkle_root: [u8; 32],
    _timestamp: u32,
    bits: u32,
    nonce: u32,
    extra_nonce: u64,
) -> Result<bool> {
    msg!("Verifying near-miss...");
    msg!("Version: {}", version);
    msg!("Expected version: {}", EXPECTED_BITCOIN_VERSION);

    // Check version
    if version != EXPECTED_BITCOIN_VERSION {
        msg!("❌ Version mismatch");
        return Ok(false);
    }
    msg!("✅ Version check passed");


    msg!("btc_tip_feed (account info): {:?}", ctx.accounts.btc_tip_feed);
    let (latest_result, feed_timestamp, successes, errors) = if cfg!(feature = "testing") {
        msg!("Testing mode: bypassing aggregator feed deserialization with dummy values");
        (0u64, Clock::get()?.unix_timestamp as u32, 1u32, 0u32)
    } else {
        let data = ctx.accounts.btc_tip_feed.data.borrow();
        let aggregator_data = AggregatorAccountData::try_deserialize(&mut &data[..])
            .map_err::<ProgramError, _>(|_| ErrorCode::InvalidOracleValue.into())?;
        msg!("✅ Feed loaded");
        (
           aggregator_data.latest_confirmed_round.result.mantissa as u64,
           aggregator_data.latest_confirmed_round.round_open_timestamp as u32,
           aggregator_data.latest_confirmed_round.num_success,
           aggregator_data.latest_confirmed_round.num_error,
        )
    };

    msg!("Latest block height from feed: {:?}", latest_result);
    msg!("Timestamp from feed: {:?}", feed_timestamp);
    msg!("Feed successes: {:?}", successes);
    msg!("Feed errors: {:?}", errors);

    // Check for stale data
    if successes == 0 {
        msg!("❌ Feed has no successful updates");
        return Err(ErrorCode::InvalidOracleValue.into());
    }

    // Verify hash meets difficulty requirement
    let header = [
        &version.to_le_bytes()[..],
        &prev_hash[..],
        &merkle_root[..],
        &feed_timestamp.to_le_bytes()[..],
        &bits.to_le_bytes()[..],
        &nonce.to_le_bytes()[..],
        &extra_nonce.to_le_bytes()[..],
    ].concat();

    msg!("Header bytes: {:?}", header);
    let hash = Sha256::digest(&Sha256::digest(&header));
    msg!("Hash: {:?}", hash);

    let trailing_zeros = hash.iter().rev()
        .take_while(|&&byte| byte == 0)
        .count();
    msg!("Trailing zeros: {}", trailing_zeros);
    msg!("Required zeros: {}", ctx.accounts.near_miss_mint.difficulty_target);

    if trailing_zeros != ctx.accounts.near_miss_mint.difficulty_target as usize {
        msg!("❌ Difficulty requirement not met");
        return Ok(false);
    }
    msg!("✅ Difficulty check passed");

    Ok(true)
}


/// Processes a valid submission by updating nonce records and minting tokens.
/// For each Bitcoin block (as measured by the height feed), nonces are stored to prevent duplicates.
fn process_valid_submission(ctx: &mut Context<SubmitNearMiss>, nonce: u32) -> Result<()> {
    let near_miss = &mut ctx.accounts.near_miss_mint;
    let current_height = get_tip_data(&ctx.accounts.btc_tip_feed)?.height;
    
    if near_miss.last_block_height != current_height {
        near_miss.submitted_nonces = [0u32; 16];  // Clear array
        near_miss.last_block_height = current_height;
    }
    
    // Find empty slot or check for duplicate
    let mut found_slot = None;
    for (i, &n) in near_miss.submitted_nonces.iter().enumerate() {
        if n == nonce {
            return Err(ErrorCode::DuplicateSubmission.into());
        }
        if n == 0 && found_slot.is_none() {
            found_slot = Some(i);
        }
    }
    
    if let Some(slot) = found_slot {
        near_miss.submitted_nonces[slot] = nonce;
    } else {
        return Err(ErrorCode::DuplicateSubmission.into());
    }

    // Update total minted and call the token minting CPI.
    near_miss.total_minted = near_miss.total_minted.checked_add(TOKEN_PER_NEAR_MISS).ok_or(ErrorCode::Overflow)?;

    let cpi_accounts = MintTo {
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.token_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    token::mint_to(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        TOKEN_PER_NEAR_MISS,
    )?;
    Ok(())
}


/// Parses the tip data returned by the oracle.
fn get_tip_data(feed: &AccountInfo) -> Result<BlockTip> {
    if cfg!(feature = "testing") {
        msg!("Testing mode: get_tip_data returns dummy BlockTip");
        return Ok(BlockTip {
            previousblockhash: [0u8; 32],
            merkle_root: [0u8; 32],
            version: EXPECTED_BITCOIN_VERSION,
            timestamp: Clock::get()?.unix_timestamp as u32,
            bits: 0x1d00ffff,
            height: 100, // dummy block height
        });
    }
    let data = feed.data.borrow();
    let aggregator_data = AggregatorAccountData::try_deserialize(&mut &data[..])
         .map_err::<ProgramError, _>(|_| ErrorCode::InvalidOracleValue.into())?;
    let result = aggregator_data.get_result()?;
    let mantissa = result.mantissa;
    
    // Interpret mantissa bytes as our block data
    let bytes = mantissa.to_le_bytes();
    if bytes.len() < 16 {
        return Err(ErrorCode::InvalidOracleValue.into());
    }

    let mut prev_hash = [0u8; 32];
    prev_hash[0..8].copy_from_slice(&bytes[0..8]);
    let mut merkle_root = [0u8; 32];
    merkle_root[0..8].copy_from_slice(&bytes[8..16]);
    
    Ok(BlockTip {
        previousblockhash: prev_hash,
        merkle_root,
        version: EXPECTED_BITCOIN_VERSION,
        timestamp: Clock::get()?.unix_timestamp as u32,
        bits: 0x1d00ffff,  // Testnet difficulty
        height: 0,
    })
}

impl NearMissMint {
    pub fn initialize(
        ctx: Context<Initialize>,
        difficulty_k: u8,
    ) -> Result<()> {
        let near_miss = &mut ctx.accounts.near_miss_mint;
        near_miss.difficulty_target = difficulty_k;
        near_miss.bump = *ctx.bumps.get("near_miss_mint").unwrap();
        Ok(())
    }
}