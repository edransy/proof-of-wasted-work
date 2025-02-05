use anchor_lang::prelude::*;

#[account]
pub struct NearMissMint {
    pub total_minted: u64,
    pub difficulty_target: u8,
    pub last_block_height: u32,
    pub submitted_nonces: [u32; 16],  // Reduced from 32 to 16
    pub bump: u8,
    pub oracle_balance: u64,
    pub treasury_balance: u64,
    pub last_prev_hash: [u8; 32],
    pub last_merkle_root: [u8; 32],
}

impl NearMissMint {
    pub const SPACE: usize = 8 + 8 + 1 + 4 + 64 + 1 + 8 + 8 + 32 + 32;
}