import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestAirdropWithRetry(connection: Connection, pubkey: PublicKey, amount: number, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const sig = await connection.requestAirdrop(pubkey, amount);
      await connection.confirmTransaction(sig);
      return true;
    } catch (e) {
      console.log(`Attempt ${i + 1} failed, waiting 10s...`);
      await sleep(10000);
    }
  }
  return false;
}

async function multiAirdrop() {
  const wallets = Array(10).fill(0).map(() => Keypair.generate());
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const target = new PublicKey("3TwSeYDdp3Gmr91Pc1Uo7QS1kzjbuRAVXv9wTaBkxroR");

  for (let i = 0; i < wallets.length; i++) {
    console.log(`\nProcessing wallet ${i + 1}...`);
    const success = await requestAirdropWithRetry(connection, wallets[i].publicKey, 2 * LAMPORTS_PER_SOL);
    
    if (success) {
      try {
        const tx = new Transaction();
        tx.feePayer = wallets[i].publicKey;
        tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
        tx.add(SystemProgram.transfer({
          fromPubkey: wallets[i].publicKey,
          toPubkey: target,
          lamports: 1.9 * LAMPORTS_PER_SOL
        }));
        
        const txSig = await connection.sendTransaction(tx, [wallets[i]]);
        await connection.confirmTransaction(txSig);
        console.log(`Transferred from wallet ${i + 1}`);
      } catch (e) {
        console.error(`Transfer failed for wallet ${i + 1}:`, e);
      }
    }
    
    await sleep(15000); // Wait 15s between wallets
  }
}

multiAirdrop().catch(console.error); 