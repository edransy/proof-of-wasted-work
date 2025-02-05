import { Connection, PublicKey } from "@solana/web3.js";
import * as switchboard from "@switchboard-xyz/switchboard-v2";

const AGGREGATOR_KEY = "21qG12heuFujVMFc4fkmQH4VFqZ92JwpoB7gP6Y7Mi9C";

async function main() {
  // Initialize connection
  const connection = new Connection(
    'https://api.devnet.solana.com',
    'confirmed'
  );

  // Create aggregator account instance
  const aggregatorPubkey = new PublicKey(AGGREGATOR_KEY);
  const program = await switchboard.loadSwitchboardProgram('devnet', connection);
  const aggregatorAccount = new switchboard.AggregatorAccount({
    program,
    publicKey: aggregatorPubkey
  });

  console.log('Monitoring aggregator:', AGGREGATOR_KEY);
  
  // Poll for updates every 10 seconds
  while (true) {
    try {
      const result = await aggregatorAccount.loadData();
      const jobAccounts = await aggregatorAccount.loadJobAccounts();
      jobAccounts.forEach(async (job) => {
        // Decode job data
        const jobDef = JSON.parse(Buffer.from(job.data).toString());
        console.log('\nJob Definition:', JSON.stringify(jobDef, null, 2));
          // Make test request and format data
        console.log('\nTesting endpoint...');
        const response = await fetch(jobDef.tasks[0].httpTask.url);
        const blockData = await response.json();
        
        // Create BlockTip struct from response
        const blockTip = {
            previousblockhash: Buffer.from(blockData[0].previousblockhash, 'hex'),
            merkle_root: Buffer.from(blockData[0].merkle_root, 'hex'),
            version: blockData[0].version,
            timestamp: blockData[0].timestamp,
            bits: blockData[0].bits,
        };

        console.log('\nFormatted Block Data:');
        result.latestConfirmedRound.result = blockTip;
        console.log(result.latestConfirmedRound.result);
      });
    } catch (error) {
      console.error('Error:', error);
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}

main().catch(console.error); 