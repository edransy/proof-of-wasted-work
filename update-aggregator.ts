import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import * as switchboard from "@switchboard-xyz/switchboard-v2";
import fs from "fs";
import yargs from "yargs";
import { hideBin } from 'yargs/helpers';

const AGGREGATOR_KEY = "DqmT7Aggc73GsuwDFtd1kZyjMrJvAy3Hc6njcdw4pmTF";

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
      describe: "Public key of the new job account",
      demandOption: true
    }
  })
  .parse() as Arguments;

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load accounts
  const payerPath = argv.payerFile.replace('~', process.env.HOME || '');
  const payerKeypair = JSON.parse(fs.readFileSync(payerPath, 'utf-8'));
  const payerAccount = Keypair.fromSecretKey(new Uint8Array(payerKeypair));
  
  const program = await switchboard.loadSwitchboardProgram('devnet', connection, payerAccount);
  
  // Get aggregator
  const aggregatorAccount = new switchboard.AggregatorAccount({
    program,
    publicKey: new PublicKey(AGGREGATOR_KEY)
  });

  // Create job account instance
  const jobAccount = new switchboard.JobAccount({
    program,
    publicKey: new PublicKey(argv.jobKey)
  });

  // Get program state account
  const [programStateAccount] = switchboard.ProgramStateAccount.fromSeed(program);

  // Get queue account
  const queueAccount = new switchboard.OracleQueueAccount({
    program,
    publicKey: new PublicKey('F8ce7MsckeZAbAGmxjJNetxYXQa9mKr9nnrC3qKubyYy')  // Devnet permissionless queue
  });

  // Get queue data for permissions
  const queueState = await queueAccount.loadData();

  // Derive permission account
  const [permissionAccount, permissionBump] = switchboard.PermissionAccount.fromSeed(
    program,
    queueState.authority,
    queueAccount.publicKey,
    aggregatorAccount.publicKey
  );

  // Get aggregator data and check authority
  const aggData = await aggregatorAccount.loadData();
  console.log('Aggregator authority:', aggData.authority.toString());
  
  if (!aggData.authority.equals(payerAccount.publicKey)) {
    console.error('Error: Payer is not the aggregator authority');
    console.log('Expected:', aggData.authority.toString());
    console.log('Got:', payerAccount.publicKey.toString());
    process.exit(1);
  }

  // Remove old job
  console.log('Updating aggregator with new job...');
  await program.methods.aggregatorRemoveJob(0)
    .accounts({
      aggregator: aggregatorAccount.publicKey,
      authority: aggData.authority,  // Use aggregator's authority
      job: jobAccount.publicKey,
      programState: programStateAccount.publicKey,
      queue: queueAccount.publicKey,
    })
    .signers([payerAccount])
    .rpc();

  console.log('Removed old job');

  // Add new job
  const [leaseAccount] = await switchboard.LeaseAccount.fromSeed(
    program,
    queueAccount,
    aggregatorAccount
  );

  await program.methods.aggregatorAddJob({
    weight: 1
  })
  .accounts({
    aggregator: aggregatorAccount.publicKey,
    authority: payerAccount.publicKey,
    job: jobAccount.publicKey,
    programState: programStateAccount.publicKey,
    queue: queueAccount.publicKey,
    escrow: (await aggregatorAccount.loadData()).tokenAccount,
    lease: leaseAccount.publicKey,
    oracleQueue: queueAccount.publicKey,
    queueAuthority: queueState.authority,
    permission: permissionAccount.publicKey,
  })
  .signers([payerAccount])
  .rpc();

  // After updating, check status
  console.log('\nChecking aggregator status...');
  const aggDataAfterUpdate = await aggregatorAccount.loadData();
  console.log('Active Jobs:', aggDataAfterUpdate.jobPubkeysData
    .filter(key => key !== "11111111111111111111111111111111")
    .map(key => key.toString())
  );
  console.log('Latest Round:', {
    success: aggDataAfterUpdate.latestConfirmedRound.numSuccess,
    error: aggDataAfterUpdate.latestConfirmedRound.numError,
    timestamp: new Date(aggDataAfterUpdate.latestConfirmedRound.roundOpenTimestamp.toNumber() * 1000)
  });

  console.log('Successfully updated aggregator');
}

main().catch(console.error); 