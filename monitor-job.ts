import { Connection, PublicKey } from "@solana/web3.js";
import * as switchboard from "@switchboard-xyz/switchboard-v2";

const JOB_KEY = "ExzfTQaNpHTBR6qQGviXRMEamveaYBRiqkPqS2LQCBL3";

async function main() {
  // Initialize connection
  const connection = new Connection(
    'https://api.devnet.solana.com',
    'confirmed'
  );

  // Create job account instance
  const jobPubkey = new PublicKey(JOB_KEY);
  const program = await switchboard.loadSwitchboardProgram('devnet', connection);
  const jobAccount = new switchboard.JobAccount({
    program,
    publicKey: jobPubkey
  });

  console.log('Analyzing job:', JOB_KEY);
  
  // Load job data
  const jobData = await jobAccount.loadData();
  
  // Decode and show job definition
  const jobDefinition = JSON.parse(Buffer.from(jobData.data).toString());
  console.log('\nJob Definition:');
  console.log(JSON.stringify(jobDefinition, null, 2));

  // Show job metadata
  console.log('\nJob Metadata:');
  console.log({
    name: Buffer.from(jobData.name).toString(),
    authority: jobData.authority.toString(),
    expiration: jobData.expiration,
    hash: jobData.hash,
    data: Buffer.from(jobData.data).toString(),
  });

  // Make test HTTP request to see response
  console.log('\nTesting HTTP endpoint...');
  const response = await fetch("https://blockstream.info/api/blocks/tip");
  const blockData = await response.json();
  console.log('Sample Response:', blockData);
}

main().catch(console.error); 