import {
  clusterApiUrl,
  Connection,
  Keypair,
} from "@solana/web3.js";
import * as switchboard from "@switchboard-xyz/switchboard-v2";
import fs from "fs";
import yargs from "yargs";
import { hideBin } from 'yargs/helpers';

interface Arguments {
  payerFile: string;
}

const argv = yargs(hideBin(process.argv))
  .options({
    'payerFile': {
      type: 'string',
      describe: "Keypair file to pay for transactions.",
      default: '~/.config/solana/id.json',
      demandOption: true
    }
  })
  .parse() as Arguments;

async function main() {
  // Initialize connection
  const connection = new Connection(
    clusterApiUrl('devnet'),
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

  // Create job definition
  const jobDefinition = {
    tasks: [
      {
        httpTask: {
          url: "https://blockstream.info/api/blocks/tip"
        }
      },
      {
        jsonParseTask: {
          path: "$[0]"
        }
      },
      {
        bufferLayoutParseTask: {
          offset: 0,
          endian: "le",
          fields: [
            { name: "previousblockhash", type: "bytes", length: 32 },
            { name: "merkle_root", type: "bytes", length: 32 },
            { name: "version", type: "u32" },
            { name: "timestamp", type: "u32" },
            { name: "bits", type: "u32" }
          ]
        }
      }
    ]
  };

  // Create a job account
  const jobKeypair = Keypair.generate();
  const jobAccount = await switchboard.JobAccount.create(program, {
    data: Buffer.from(JSON.stringify(jobDefinition)),
    keypair: jobKeypair,
    authority: payerAccount.publicKey,
  });

  console.log(`Created job account: ${jobAccount.publicKey.toBase58()}`);
  console.log(`https://explorer.solana.com/address/${jobAccount.publicKey.toBase58()}?cluster=devnet`);
}

main().then(
  () => process.exit(),
  err => {
    console.error(err);
    process.exit(-1);
  }
);