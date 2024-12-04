import { Connection, PublicKey, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import createWallet from './create_wallet';
import retrytransaction from './raydiumSwap';
import { WSOL } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';
import { private_key, delay_time, rpc_uri, amount, public_key } from './config';


// Function to transfer SOL to a new wallet
async function fundWallet(connection: Connection, fromWallet: Keypair, toWalletPublicKey: string, amountSol: number) {
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromWallet.publicKey,
      toPubkey: new PublicKey(toWalletPublicKey),
      lamports: amountSol * LAMPORTS_PER_SOL, // Convert SOL to lamports
    })
  );
  // Send and confirm the transaction
  const signature = await connection.sendTransaction(transaction, [fromWallet]);
  console.log("Transaction signature:", signature);
}

async function getRentExemptBalance(connection: Connection, accountDataSize: number) {
  const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(accountDataSize);
  return rentExemptBalance;
}

async function refundAllBalance(
  connection: Connection,
  fromWallet: Keypair,
  toWalletPublicKey: string
) {
  // Get the current balance of the source account
  const fromBalance = await connection.getBalance(fromWallet.publicKey);

  if (fromBalance === 0) {
    console.log("No balance available to refund.");
    return;
  }

  console.log(`Refunding balance: ${fromBalance / LAMPORTS_PER_SOL} SOL`);

  // Create the transaction to transfer the entire balance
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromWallet.publicKey,
      toPubkey: new PublicKey(toWalletPublicKey),
      lamports: fromBalance - 5e3, // Transfer all SOL
    })
  );

  // Send the transaction
  const signature = await connection.sendTransaction(transaction, [fromWallet]);
  console.log("Refund transaction signature:", signature);
}

// Example Usage
export default async function fundAndRefund(mintToBuy: string, poolAccount: string) {
  const connection = new Connection(rpc_uri, "confirmed");
  const fundingWallet = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(private_key)));

  const newWallet = createWallet(); // Create a new wallet
  console.log("amount: ",  amount);
  await fundWallet(connection, fundingWallet, newWallet.publicKey.toBase58(), amount); // Fund with 1 SOL
  console.log("funded SOL in newly created wallet");
  const calcSwapAmount = ((amount - 0.0042) * 1e9 - 5e3 * 3 - 2930000) / 1e9;

  if (calcSwapAmount < 0) {
    console.log("Please set deposit amount larger than fee");
    return;
  }
  console.log("MintToBuy", mintToBuy);
  await retrytransaction(calcSwapAmount, mintToBuy, poolAccount, bs58.encode(newWallet.secretKey));  // swap sol to mintToBuy token

  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(newWallet.publicKey, {
    mint: new PublicKey(mintToBuy),
  });
  if (tokenAccounts.value.length === 0) {
    console.log('Wallet does not hold this token.');
    return;
  }
  const tokenAmount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
  console.log(tokenAmount);

  setTimeout(async () => {
    console.log("Exchange the Specific Coin into SOL and refund to main Wallet");
    await retrytransaction(tokenAmount, WSOL.mint, poolAccount, bs58.encode(newWallet.secretKey));
    const secretKey = Buffer.from(newWallet.secretKey).toString('hex');
    const secretKeyBase58 = bs58.encode(Uint8Array.from(
      secretKey.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
    ));

    const fromWallet = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(secretKeyBase58)));
    await refundAllBalance(connection, fromWallet, public_key);
  }, delay_time);

}