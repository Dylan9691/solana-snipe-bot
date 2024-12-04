import { Connection, PublicKey } from '@solana/web3.js';
import getTvlFromId from './tvl';
import getTokenMetadata from './social';
import { WSOL } from '@raydium-io/raydium-sdk';
import { limit_social, limit_tvl } from './config';
import { HTTP_URL, WSS_URL, RAYDIUM_PUBLIC_KEY } from './config';
import fundAndRefund from "./fund";

const RAYDIUM = new PublicKey(RAYDIUM_PUBLIC_KEY);
const INSTRUCTION_NAME = "initialize2";

const connection = new Connection(HTTP_URL, {
    wsEndpoint: WSS_URL
});

async function startConnection(connection: Connection, programAddress: PublicKey, searchInstruction: string): Promise<void> {
    console.log("Monitoring logs for program:", programAddress.toString());
    connection.onLogs(
        programAddress,
        ({ logs, err, signature }) => {
            if (err) return;

            if (logs && logs.some(log => log.includes(searchInstruction))) {
                console.log("Signature for 'initialize2':", `https://explorer.solana.com/tx/${signature}`);
                fetchRaydiumMints(signature, connection);
            }
        },
        "finalized"
    );
}

async function fetchRaydiumMints(txId: string, connection: Connection) {
    try {
        const tx = await connection.getParsedTransaction(
            txId,
            {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed'
            });

        //@ts-ignore
        const accounts = (tx?.transaction.message.instructions).find(ix => ix.programId.toBase58() === RAYDIUM_PUBLIC_KEY).accounts as PublicKey[];

        if (!accounts) {
            console.log("No accounts found in the transaction.");
            return;
        }

        const poolIndex = 4;
        const tokenAIndex = 8;
        const tokenBIndex = 9;

        const poolAccount = accounts[poolIndex].toBase58();
        const tokenAAccount = accounts[tokenAIndex].toBase58();
        const tokenBAccount = accounts[tokenBIndex].toBase58();

        const displayData = [
            { "Token": "Pool", "Account Public Key": poolAccount },
            { "Token": "A", "Account Public Key": tokenAAccount },
            { "Token": "B", "Account Public Key": tokenBAccount }
        ];

        console.log("New LP Found");
        console.table(displayData);

        if (tokenAAccount == WSOL.mint || tokenBAccount == WSOL.mint) {
            let memeAccount = (tokenAAccount == WSOL.mint) ? tokenBAccount : tokenAAccount;

            let tvl = await getTvlFromId(poolAccount);
            tvl = tvl ? tvl : 0;
            let cntSocial = await getTokenMetadata(memeAccount);

            if (tvl >= limit_tvl && cntSocial >= limit_social) {

                await fundAndRefund(memeAccount, poolAccount);
            }
            else {
                console.log("Detected account is rug");
            }
        }
        else {
            console.log("Detected account is not related with SOL");
        }

    } catch {
        console.log("Error fetching transaction:", txId);
        return;
    }
}

startConnection(connection, RAYDIUM, INSTRUCTION_NAME).catch(console.error);