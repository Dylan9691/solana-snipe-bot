import {
  LIQUIDITY_STATE_LAYOUT_V4,
  LiquidityPoolKeys,
  MAINNET_PROGRAM_ID,
  MARKET_STATE_LAYOUT_V3,
  LiquidityPoolInfo,
  TOKEN_PROGRAM_ID,
  WSOL,
  Liquidity,
  Percent,
  Token,
  TokenAmount,
} from "@raydium-io/raydium-sdk";
import bs58 from 'bs58';
import retry from 'async-await-retry';
import BN from 'bn.js';
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createWrappedNativeAccount,
  getOrCreateAssociatedTokenAccount,
  createSyncNativeInstruction,
  NATIVE_MINT,
  createAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { raydium_auth_v4, rpc_uri } from "./config";

const getPoolKeys = async (ammId: string, connection: Connection) => {
  const ammAccount = await connection.getAccountInfo(new PublicKey(ammId));
  if (ammAccount) {
    const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(ammAccount.data);
    const marketAccount = await connection.getAccountInfo(poolState.marketId);
    if (marketAccount) {
      const marketState = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);
      const marketAuthority = PublicKey.createProgramAddressSync(
        [
          marketState.ownAddress.toBuffer(),
          marketState.vaultSignerNonce.toArrayLike(Buffer, "le", 8),
        ],
        MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
      );
      return {
        id: new PublicKey(ammId),
        programId: MAINNET_PROGRAM_ID.AmmV4,
        status: poolState.status,
        baseDecimals: poolState.baseDecimal.toNumber(),
        quoteDecimals: poolState.quoteDecimal.toNumber(),
        lpDecimals: 9,
        baseMint: poolState.baseMint,
        quoteMint: poolState.quoteMint,
        version: 4,
        authority: new PublicKey(
          raydium_auth_v4,
        ),
        openOrders: poolState.openOrders,
        baseVault: poolState.baseVault,
        quoteVault: poolState.quoteVault,
        marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
        marketId: marketState.ownAddress,
        marketBids: marketState.bids,
        marketAsks: marketState.asks,
        marketEventQueue: marketState.eventQueue,
        marketBaseVault: marketState.baseVault,
        marketQuoteVault: marketState.quoteVault,
        marketAuthority: marketAuthority,
        targetOrders: poolState.targetOrders,
        lpMint: poolState.lpMint,
      } as unknown as LiquidityPoolKeys;
    }
  }
};

const calculateAmountOut = async (
  poolKeys: LiquidityPoolKeys,
  poolInfo: LiquidityPoolInfo,
  tokenToBuy: string,
  amountIn: number,
  rawSlippage: number,
) => {
  let tokenOutMint = new PublicKey(tokenToBuy);
  let tokenOutDecimals =
    poolKeys.baseMint.equals(tokenOutMint)
      ? poolInfo.baseDecimals
      : poolKeys.quoteDecimals;
  let tokenInMint =
    poolKeys.baseMint.equals(tokenOutMint) ? poolKeys.quoteMint : poolKeys.baseMint;
  let tokenInDecimals =
    poolKeys.baseMint.equals(tokenOutMint)
      ? poolInfo.quoteDecimals
      : poolInfo.baseDecimals;
  const tokenIn = new Token(TOKEN_PROGRAM_ID, tokenInMint, tokenInDecimals);
  const tknAmountIn = new TokenAmount(tokenIn, amountIn, false);
  const tokenOut = new Token(TOKEN_PROGRAM_ID, tokenOutMint, tokenOutDecimals);
  const slippage = new Percent(rawSlippage, 100);
  return {
    amountIn: tknAmountIn,
    tokenIn: tokenInMint,
    tokenOut: tokenOutMint,
    ...Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn: tknAmountIn,
      currencyOut: tokenOut,
      slippage,
    }),
  };
};

const makeSwapInstruction = async (
  connection: Connection,
  tokenToBuy: string,
  rawAmountIn: number,
  slippage: number,
  poolKeys: LiquidityPoolKeys,
  poolInfo: LiquidityPoolInfo,
  keyPair: Keypair,
) => {
  const { amountIn, tokenIn, tokenOut, minAmountOut } =
    await calculateAmountOut(
      poolKeys,
      poolInfo,
      tokenToBuy,
      rawAmountIn,
      slippage,
    );
  let tokenInAccount: PublicKey;
  let tokenOutAccount: PublicKey;

  if (tokenIn.toString() == WSOL.mint) {
    tokenInAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        keyPair,
        tokenIn,
        keyPair.publicKey,
      )
    ).address;
    try {
      tokenOutAccount = (
        await getOrCreateAssociatedTokenAccount(
          connection,
          keyPair,
          tokenOut,
          keyPair.publicKey,
        )
      ).address;
    } catch (error) {
      tokenOutAccount = (
        await getOrCreateAssociatedTokenAccount(
          connection,
          keyPair,
          tokenIn,
          keyPair.publicKey,
        )
      ).address;
    }


  } else {
    tokenOutAccount = (await getOrCreateAssociatedTokenAccount(
      connection,
      keyPair,
      NATIVE_MINT,
      keyPair.publicKey
    )).address;
    tokenInAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        keyPair,
        tokenIn,
        keyPair.publicKey,
      )
    ).address;
  }

  const ix = new TransactionInstruction({
    programId: new PublicKey(poolKeys.programId),
    keys: [
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: poolKeys.id, isSigner: false, isWritable: true },
      { pubkey: poolKeys.authority, isSigner: false, isWritable: false },
      { pubkey: poolKeys.openOrders, isSigner: false, isWritable: true },
      { pubkey: poolKeys.baseVault, isSigner: false, isWritable: true },
      { pubkey: poolKeys.quoteVault, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketProgramId, isSigner: false, isWritable: false },
      { pubkey: poolKeys.marketId, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketBids, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketAsks, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketEventQueue, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketBaseVault, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketQuoteVault, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketAuthority, isSigner: false, isWritable: false },
      { pubkey: tokenInAccount, isSigner: false, isWritable: true },
      { pubkey: tokenOutAccount, isSigner: false, isWritable: true },
      { pubkey: keyPair.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(
      Uint8Array.of(
        9,
        ...new BN(amountIn.raw).toArray("le", 8),
        ...new BN(minAmountOut.raw).toArray("le", 8),
      ),
    ),
  });
  return {
    swapIX: ix,
    tokenInAccount: tokenInAccount,
    tokenOutAccount: tokenOutAccount,
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
  };
};

const executeTransaction = async (swapAmountIn: number, tokenToBuy: string, ammId: string, wallet_private_key: string) => {
  const connection = new Connection(rpc_uri, "confirmed");
  const secretKey = new Uint8Array(bs58.decode(wallet_private_key));
  // Uint8Array.from(
  //   JSON.parse(fs.readFileSync(`./keypair.json`) as unknown as string),
  // );
  const keyPair = Keypair.fromSecretKey(secretKey);
  const slippage = 2; // 2% slippage tolerance

  console.log(await getOrCreateAssociatedTokenAccount(connection, keyPair, new PublicKey(tokenToBuy), keyPair.publicKey));
  console.log(await getOrCreateAssociatedTokenAccount(connection, keyPair, new PublicKey(WSOL.mint), keyPair.publicKey));

  const poolKeys = await getPoolKeys(ammId, connection);
  if (poolKeys) {
    const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
    const txn = new Transaction();
    const {
      swapIX,
      tokenInAccount,
      tokenIn,
      amountIn
    } = await makeSwapInstruction(
      connection,
      tokenToBuy,
      swapAmountIn,
      slippage,
      poolKeys,
      poolInfo,
      keyPair,
    );

    if (tokenIn.toString() == WSOL.mint) {
      // Convert SOL to Wrapped SOL
      txn.add(
        SystemProgram.transfer({
          fromPubkey: keyPair.publicKey,
          toPubkey: tokenInAccount,
          lamports: amountIn.raw.toNumber(),
        }),
        createSyncNativeInstruction(tokenInAccount, TOKEN_PROGRAM_ID),
      );
    }
    txn.add(swapIX);
    const hash = await sendAndConfirmTransaction(connection, txn, [keyPair], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    console.log("Transaction Completed Successfully 🎉🚀.");
    console.log(`Explorer URL: https://solscan.io/tx/${hash}`);
  } else {
    console.log(`Could not get PoolKeys for AMM: ${ammId}`);
  }
};



export default async function retrytransaction(swapAmount: number, mintToBuy: string, poolAccount: string, wallet_private_key: string) {
  console.log("swapAmount: ", swapAmount);
  console.log("mintToBuy: ", mintToBuy);
  console.log("poolAccount: ", poolAccount);
  console.log("wallet_private_key: ", wallet_private_key);
  try {
    await retry(
      async () => 
        await executeTransaction(swapAmount, mintToBuy, poolAccount, wallet_private_key),
      undefined,
      {
        retriesMax: 3,
        interval: 100,
      }
    );
      } catch (error) {
    console.log("An error is occured when the Transaction is retried", error);
  }
}
const calcSwapAmount = ((0.01 - 0.0042) * 1e9 - 5e3 * 3 - 2930000) / 1e9;
console.log(calcSwapAmount);
retrytransaction(calcSwapAmount, 'CyyPJ2QZFA2EqSLeBUqJrYRS6wpjK3Eng1pA9hGqzfgX', '9mxWzxRSP9Ft2ZQbZnkBKF9SbrPXBtrfMiaCCRCg2yu7',  '2NPtRdyr2azY7BnggbnLqR43r8GP2Lj4Q2oyAGKvUwig4GPkM8qLc1Ldsrw1w4QpMRTpj1QE8GkbkAsGJsmjzsH');
//3nJWSypLTbLjFPQbTvoncPTHfe77NdYEs8T2VQY36DP9Gss9RXPyRd6mmTnvcJRAQJNVVvHaWVxwtboCXUtS1GM2




// const connection = new Connection(rpc_uri);
// connection.getTokenAccountBalance(new PublicKey("B1jKWfA1DXGWexvqhCxvzDY7gZs6YbhfbCJosbyMPTRz")).then(async balance => {
//   const balance1= await connection.getTokenAccountBalance(new PublicKey("2mCzRRuJbGJw5ctopuwWpYPatnRUS5UnXpfSPkLCCGrn"));
//   console.log(balance.value.uiAmount, balance1.value.uiAmount);
//   if (balance.value.uiAmount && balance1.value.uiAmount)
//     console.log(balance.value.uiAmount / balance1.value.uiAmount);
// });