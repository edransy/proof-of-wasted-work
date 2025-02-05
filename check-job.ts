import { Connection, PublicKey } from "@solana/web3.js";
import * as switchboard from "@switchboard-xyz/switchboard-v2";

const JOB_KEY = "CGTfw3vGMkpVxwb1kuoa5oAJnKtnwhe7nc6FAmP1KvdC";

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const program = await switchboard.loadSwitchboardProgram('devnet', connection);
  
  // Load job account
  const jobAccount = new switchboard.JobAccount({
    program,
    publicKey: new PublicKey(JOB_KEY)
  });

  // Get job data
  const jobData = await jobAccount.loadData();
  console.log('\nJob Data:');
  console.log('Name:', Buffer.from(jobData.name).toString());
  console.log('Authority:', jobData.authority.toString());
  console.log('Hash:', Buffer.from(jobData.hash).toString('hex'));
  
  // Parse job definition
  const jobDef = JSON.parse(Buffer.from(jobData.data).toString());
  console.log('\nJob Definition:');
  console.log(JSON.stringify(jobDef, null, 2));

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
  console.log(blockTip);
  console.log('\nExpected Binary Length:', 
    32 + // previousblockhash
    32 + // merkle_root
    4 +  // version
    4 +  // timestamp
    4    // bits
  );
}

main().catch(console.error); 