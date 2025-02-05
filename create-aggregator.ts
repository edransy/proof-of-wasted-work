import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import * as switchboard from "@switchboard-xyz/switchboard-v2";
import * as spl from "@solana/spl-token";
import fs from "fs";
import yargs from "yargs";
import { hideBin } from 'yargs/helpers';
import { BN } from "@project-serum/anchor";

interface Arguments {
  payerFile: string;
  jobKey: string;
}

const argv = yargs(hideBin(process.argv))
  .options({
    'payerFile': {
      type: 'string',
      describe: "Keypair file to pay for transactions.",
      default: '~/.config/solana/id.json',
      demandOption: true
    },
    'jobKey': {
      type: 'string',
      describe: "Public key of the job account",
      default: 'ExzfTQaNpHTBR6qQGviXRMEamveaYBRiqkPqS2LQCBL3',
      demandOption: true
    }
  })
  .parse() as Arguments;

async function main() {
  // Initialize connection with alternative devnet RPC
  const connection = new Connection(
    'https://api.devnet.solana.com',  // Try other endpoints if this fails:
    // 'https://devnet.genesysgo.net/v1/',
    // 'https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY',
    'confirmed'
  );

  // Load payer account
  const payerPath = argv.payerFile.replace('~', process.env.HOME || '');
  const payerKeypair = JSON.parse(fs.readFileSync(payerPath, 'utf-8'));
  const payerAccount = Keypair.fromSecretKey(new Uint8Array(payerKeypair));

  // Initialize program
  const program = await switchboard.loadSwitchboardProgram(
    'devnet',
    connection,
    payerAccount
  );

  // Get the default queue of oracles
  const queueAccount = new switchboard.OracleQueueAccount({
    program,
    publicKey: new PublicKey('F8ce7MsckeZAbAGmxjJNetxYXQa9mKr9nnrC3qKubyYy')  // Devnet permissionless queue
  });

  // Create an aggregator
  console.log('Creating aggregator account...');
  const aggregatorKeypair = Keypair.generate();
  
  const aggregatorAccount = await switchboard.AggregatorAccount.create(program, {
    keypair: aggregatorKeypair,
    authority: payerAccount.publicKey,
    queueAccount: queueAccount,
    name: Buffer.from("BTC Block Tip Aggregator"),
    batchSize: 1,
    minRequiredOracleResults: 1,
    minRequiredJobResults: 1,
    minUpdateDelaySeconds: 60,
  });

  console.log(`Created aggregator account: ${aggregatorAccount.publicKey.toBase58()}`);
  console.log(`https://explorer.solana.com/address/${aggregatorAccount.publicKey.toBase58()}?cluster=devnet`);

  // After creating aggregator account
  console.log('Adding job to aggregator...');
  const jobAccount = new switchboard.JobAccount({
    program,
    publicKey: new PublicKey(argv.jobKey)
  });

  const queueState = await queueAccount.loadData();

  const [permissionAccount, permissionBump] = switchboard.PermissionAccount.fromSeed(
    program,
    queueState.authority,
    queueAccount.publicKey,
    aggregatorAccount.publicKey
  );

  const [programStateAccount, stateBump] = switchboard.ProgramStateAccount.fromSeed(program);

  await program.methods.aggregatorAddJob({
    weight: 1
  })
  .accounts({
    aggregator: aggregatorAccount.publicKey,
    authority: payerAccount.publicKey,
    job: jobAccount.publicKey,
    permissionAccount: permissionAccount.publicKey,
    programState: programStateAccount.publicKey,
    queue: queueAccount.publicKey,
  })
  .signers([payerAccount])
  .rpc();

  // After adding job
  console.log('Setting queue authority...');
  await aggregatorAccount.setAuthority(queueState.authority, payerAccount);

  // Create and fund token account for lease
  const mint = await queueAccount.loadMint();
  
  // Create wrapped SOL account
  const wrappedSolAccount = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(spl.ACCOUNT_SIZE);
  const createWrappedSolIx = spl.createInitializeAccountInstruction(
    wrappedSolAccount.publicKey,
    spl.NATIVE_MINT,
    payerAccount.publicKey
  );

  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: payerAccount.publicKey,
    newAccountPubkey: wrappedSolAccount.publicKey,
    space: spl.ACCOUNT_SIZE,
    lamports: rent + 1 * LAMPORTS_PER_SOL, // Reduced from 3 SOL to 1 SOL
    programId: spl.TOKEN_PROGRAM_ID,
  });

  // Second tx for wrapped SOL account
  const wrappedSolTx = new Transaction()
    .add(createAccountIx)
    .add(createWrappedSolIx);

  await sendAndConfirmTransaction(connection, wrappedSolTx, [payerAccount, wrappedSolAccount]);

  // Then create lease with wrapped SOL account
  console.log('Creating and funding lease...');
  const leaseAccount = await switchboard.LeaseAccount.create(program, {
    loadAmount: new BN(0.5 * 1e9), // Reduced from 2.5 SOL to 0.5 SOL
    funder: wrappedSolAccount.publicKey,
    funderAuthority: payerAccount,
    aggregatorAccount: aggregatorAccount,
    oracleQueueAccount: queueAccount,
  });

  // Create permission for oracles to update
  await switchboard.PermissionAccount.create(program, {
    authority: queueState.authority,
    granter: queueAccount.publicKey,
    grantee: aggregatorAccount.publicKey,
  });

  // Then request initial update
  console.log('Requesting initial aggregator update...');
  const txn = await aggregatorAccount.openRound({
    oracleQueueAccount: queueAccount,
    payoutWallet: wrappedSolAccount.publicKey,
  });
  console.log(`Update request sent: ${txn}`);

};


main().then(
  () => process.exit(),
  err => {
    console.error(err);
    process.exit(-1);
  }
); 