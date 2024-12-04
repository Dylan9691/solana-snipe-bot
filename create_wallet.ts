import { Keypair } from '@solana/web3.js';

// Function to create a new wallet
export default function createWallet() {
  const newWallet = Keypair.generate(); // Generates a new keypair
  console.log("New wallet created:");
  console.log("Public Key:", newWallet.publicKey.toBase58());
  console.log("Private Key:", Buffer.from(newWallet.secretKey).toString('hex'));
  return newWallet;
}



