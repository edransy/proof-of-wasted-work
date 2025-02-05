import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { expect } from "chai";
import { sha256 } from "js-sha256";
import { ProofOfWastedWork } from "../target/types/proof_of_wasted_work";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from '@solana/spl-token';
import { 
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import * as switchboard from "@switchboard-xyz/switchboard-v2";


describe("proof_of_wasted_work", () => {
  // Configure the client to use the local cluster with a test wallet
  const wallet = anchor.web3.Keypair.generate();
  const provider = new anchor.AnchorProvider(
    anchor.AnchorProvider.env().connection,
    new anchor.Wallet(wallet),
    {}
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.ProofOfWastedWork as Program<ProofOfWastedWork>;
  if (!program) throw new Error("Program not found in workspace");
  
  // Test accounts
  const miner = Keypair.generate();
  const tokenMint = Keypair.generate();
  
  // Test parameters
  const DIFFICULTY_K = 2;
  let SWITCHBOARD_BTC_BLOCK_TIP = "32acusHT67wNeJMC9SzD5J6uV9QdN38YSXiGWE9yUvYc";  // Real devnet feed

  // Helper function to generate double SHA256 hash
  function dblSha256(data: Buffer): Buffer {
    const firstHash = sha256.create();
    firstHash.update(data);
    const secondHash = sha256.create();
    secondHash.update(Buffer.from(firstHash.array()));
    return Buffer.from(secondHash.array());
  }

  // Helper to count trailing zeros
  function countTrailingZeros(hash: Buffer): number {
    let count = 0;
    for (let i = hash.length - 1; i >= 0; i--) {
      if (hash[i] !== 0) break;
      count++;
    }
    return count;
  }

  // Generate valid near-miss data
  async function generateNearMiss(): Promise<{
    version: number,
    prevHash: Buffer,
    merkleRoot: Buffer,
    timestamp: number,
    bits: number,
    nonce: number,
    extraNonce: anchor.BN
  }> {
    const version = 0x20000000;
    const prevHash = Buffer.alloc(32, 1);
    const merkleRoot = Buffer.alloc(32, 2);
    const timestamp = Math.floor(Date.now() / 1000);
    const bits = 0x1d00ffff;
    
    let nonce = 0;
    let extraNonce = new anchor.BN(0);
    let found = false;
    let lastLog = Date.now();
    const LOG_INTERVAL = 1000; // Log every second

    while (!found && nonce < 1_000_000_000) {
      // Construct header using little-endian encoding to match on-chain verification
      const header = Buffer.concat([
        (() => {
          const buf = Buffer.alloc(4);
          buf.writeUInt32LE(version, 0);
          return buf;
        })(),
        prevHash,
        merkleRoot,
        (() => {
          const buf = Buffer.alloc(4);
          buf.writeUInt32LE(timestamp, 0);
          return buf;
        })(),
        (() => {
          const buf = Buffer.alloc(4);
          buf.writeUInt32LE(bits, 0);
          return buf;
        })(),
        (() => {
          const buf = Buffer.alloc(4);
          buf.writeUInt32LE(nonce, 0);
          return buf;
        })(),
        (() => {
          // extraNonce is an anchor.BN; output an 8-byte little-endian Buffer
          return extraNonce.toArrayLike(Buffer, 'le', 8);
        })(),
      ]);

      const hash = dblSha256(header);
      const zeros = countTrailingZeros(hash);
      
      // Log progress periodically
      const now = Date.now();
      if (now - lastLog > LOG_INTERVAL) {
        console.log(`Nonce: ${nonce.toLocaleString()}, Hash: ${hash.toString('hex').slice(-8)}, Trailing zeros: ${zeros}/${DIFFICULTY_K}`);
        lastLog = now;
      }

      if (zeros === DIFFICULTY_K) {
        console.log(`\nFound solution! Nonce: ${nonce.toLocaleString()}`);
        console.log(`Final hash: ${hash.toString('hex')}`);
        found = true;
        break;
      }
      nonce++;
    }

    if (!found) {
      throw new Error("Could not find valid near-miss in reasonable time");
    }

    return {
      version,
      prevHash,
      merkleRoot,
      timestamp,
      bits,
      nonce,
      extraNonce
    };
    
  }


  // Store mockFeed in a variable accessible to tests
  let mockFeed: Keypair;
  let btcATA: PublicKey;

  before(async () => {
    // Subscribe to program logs
    program.provider.connection.onLogs(program.programId, (logs) => {
      console.log("\nProgram Logs:", logs.logs);
    });

    console.log("\n=== Starting Test Setup ===");
    console.log("Program ID:", program.programId.toString());
    
    console.log("\n--- Test Setup ---");
    console.log("Airdropping SOL to test wallet...");
    const airdropSig = await provider.connection.requestAirdrop(
      wallet.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    console.log("Creating mock Switchboard feed...");
    mockFeed = Keypair.generate();
    
    // Use the literal expected aggregator program ID so that owner assignment works reliably in tests.
    const expectedOwner = new anchor.web3.PublicKey("SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f");
    
    const feedTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mockFeed.publicKey,
        space: 1024,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(1024),
        programId: expectedOwner
      })
    );
    
    // Create the account on chain
    await provider.sendAndConfirm(feedTx, [wallet, mockFeed]);
    
    // Reassign the account's owner to expectedOwner to ensure it matches what the on-chain program expects.
    const assignIx = SystemProgram.assign({
      accountPubkey: mockFeed.publicKey,
      programId: expectedOwner,
    });
    await provider.sendAndConfirm(new Transaction().add(assignIx), [mockFeed]); 

    const feedInfo = await provider.connection.getAccountInfo(mockFeed.publicKey);
    console.log("Feed info:", feedInfo);
    // Write mock data with correct AggregatorAccountData discriminator
    const mockData = Buffer.alloc(1024);
    // Compute the discriminator as the first 8 bytes of sha256("account:AggregatorAccountData")
    const aggregatorDiscriminatorArray = sha256.create()
      .update("account:AggregatorAccountData")
      .array()
      .slice(0, 8);
    const aggregatorDiscriminator = Buffer.from(aggregatorDiscriminatorArray);
    aggregatorDiscriminator.copy(mockData, 0);

    // Add mock aggregator data
    const data = Buffer.alloc(240);
    data.writeUInt32LE(1, 0);  // version
    data.writeBigUInt64LE(BigInt(Date.now()), 8);  // timestamp
    data.writeBigInt64LE(BigInt(770000), 16);  // value
    data.writeUInt32LE(1, 24);  // numSuccess
    data.writeUInt32LE(0, 28);  // numError
    data.copy(mockData, 8);

    // Write the mock data to the account
    const writeIx = SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mockFeed.publicKey,
      space: mockData.length,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(mockData.length),
      programId: expectedOwner,
    });
    
    await provider.sendAndConfirm(
      new Transaction()
        .add(writeIx)
        .add(SystemProgram.assign({
          accountPubkey: mockFeed.publicKey,
          programId: expectedOwner,
        })), 
      [wallet, mockFeed]
    );
    
    // Write the actual data
    await provider.connection.getAccountInfo(mockFeed.publicKey);
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [{ pubkey: mockFeed.publicKey, isSigner: true, isWritable: true }],
        programId: expectedOwner,
        data: mockData,
      })
    );
    await provider.sendAndConfirm(tx, [mockFeed]);

    console.log("Transferring SOL to miner...");
    const tx2 = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: miner.publicKey,
        lamports: LAMPORTS_PER_SOL / 2,
      })
    );
    await provider.sendAndConfirm(tx2);

    console.log("Creating token mint...");
    console.log("systemProgram:", SystemProgram, SystemProgram.programId.toString());
    await program.methods.createMint()
      .accounts({
        tokenMint: tokenMint.publicKey,
        authority: miner.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([miner, tokenMint])
      .rpc();
  });

  it("Initializes the program state", async () => {
    console.log("\n--- Initializing Program State ---");
    console.log("Program ID:", program.programId.toString());
    
    const [nearMissMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("nearmiss_mint", "utf8")],
      program.programId
    );

    await program.methods
      .initialize(DIFFICULTY_K)
      .accounts({
        nearMissMint,
        mintAuthority: miner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([miner])
      .rpc(); 

    const state = await program.account.nearMissMint.fetch(nearMissMint);
    expect(state.difficultyTarget).to.equal(DIFFICULTY_K);
  });

  it("Successfully mints tokens for valid near-miss", async () => {
    console.log("\n=== Testing Valid Near-Miss ===");
    
    const {
      version,
      prevHash,
      merkleRoot,
      timestamp,
      bits,
      nonce,
      extraNonce
    } = await generateNearMiss();

    console.log("Submitting with values:");
    console.log("Version:", version);
    console.log("Nonce:", nonce);
    console.log("Extra Nonce:", extraNonce.toString());

    try {
      console.log("Submitting near-miss to program...");
      // Get PDA addresses
      const [nearMissMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("nearmiss_mint", "utf8")],
        program.programId
      );
      const [oracleMaintenance] = PublicKey.findProgramAddressSync(
        [Buffer.from("oracle_maintenance", "utf8")],
        program.programId
      );
      const [treasury] = PublicKey.findProgramAddressSync(
        [Buffer.from("treasury", "utf8")],
        program.programId
      );

      // Get associated token account for miner
      const minerATA = await anchor.utils.token.associatedAddress({
        mint: tokenMint.publicKey,
        owner: miner.publicKey
      });

      // Instead of computing an associated token account for btc_tip_feed,
      // use the actual mock feed public key.
      const btcTipFeed = mockFeed.publicKey;

      const submitNearMissAccounts = {
        mintAuthority: miner.publicKey,
        nearMissMint,
        mintAuthorityInfo: miner.publicKey,
        oracleMaintenance,
        treasury,
        tokenMint: tokenMint.publicKey,
        tokenAccount: minerATA,
        btcTipFeed: btcTipFeed,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      }

      // Submit near-miss
      await program.methods
        .submitNearMiss(
          version,
          Array.from(prevHash),
          Array.from(merkleRoot),
          timestamp,
          bits,
          nonce,
          extraNonce
        )
        .accounts(submitNearMissAccounts)
        .signers([miner])
        .rpc();

      console.log("Verifying token minting...");
      // Verify token minting
      const minerTokenAccount = await program.provider.connection.getTokenAccountBalance(
        minerATA
      );
      expect(Number(minerTokenAccount.value.amount)).to.equal(100); // TOKEN_PER_NEAR_MISS
    } catch (error) {
      console.error("Error details:", error);
      throw error;
    }
  });

  it("Rejects invalid near-miss submission", async () => {
    console.log("\n--- Testing Invalid Near-Miss Submission ---");
    console.log("Generating invalid data...");
    // Generate invalid data (not meeting difficulty requirement)
    const invalidData = {
      version: 0x20000000,
      prevHash: Buffer.alloc(32, 1),
      merkleRoot: Buffer.alloc(32, 2),
      timestamp: Math.floor(Date.now() / 1000),
      bits: 0x1d00ffff,
      nonce: 0,
      extraNonce: new anchor.BN(0)
    };

    // Attempt submission with invalid data
    try {
      await program.methods
        .submitNearMiss(
          invalidData.version,
          Array.from(invalidData.prevHash),
          Array.from(invalidData.merkleRoot),
          invalidData.timestamp,
          invalidData.bits,
          invalidData.nonce,
          invalidData.extraNonce
        )
        .accounts({
          // ... accounts ...
        })
        .signers([miner])
        .rpc();
      
      expect.fail("Should have rejected invalid submission");
    } catch (error) {
      expect(error.toString()).to.include("InvalidNearMiss");
    }
  });
});
