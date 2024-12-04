import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4 } from '@raydium-io/raydium-sdk'; // Ensure you have the correct path
import { rpc_uri } from './config';

const connection = new Connection(rpc_uri, 'confirmed');

import axios from 'axios';
import { min } from 'bn.js';

async function getSOLPrice() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const solPrice = response.data.solana.usd;
    console.log('Price of SOL:', solPrice, 'USD');
    return solPrice;
  } catch (error) {
    console.error('Error fetching SOL price:', error);
  }
}



export default async function getTvlFromId(poolAccount : string){
  const poolAddress = new PublicKey(poolAccount);
  const accountInfo = await connection.getAccountInfo(poolAddress);


    if (accountInfo !== null) {
        const decodedData = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.data);

        const baseVault = new PublicKey(decodedData.baseVault);
        const quoteVault = new PublicKey(decodedData.quoteVault);

        const baseTokenInfo = await connection.getTokenAccountBalance(baseVault);
        const quoteTokenInfo = await connection.getTokenAccountBalance(quoteVault);

        const cnt = baseTokenInfo?.value?.uiAmount !== null && quoteTokenInfo?.value?.uiAmount !== null
          ? Math.min(baseTokenInfo.value.uiAmount, quoteTokenInfo.value.uiAmount)
          : 0;
          
        let TVL = await getSOLPrice();
        if (baseTokenInfo.value.uiAmount) {
            TVL = TVL * cnt;
            console.log("Amount of the SOL in the POOL is ", TVL, "USD");
        }
        if (baseTokenInfo.value.uiAmount==null) return 0;
        return baseTokenInfo.value.uiAmount ;
        
    }
    
};