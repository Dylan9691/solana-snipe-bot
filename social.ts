import { Metaplex } from "@metaplex-foundation/js";
import { Connection, PublicKey } from "@solana/web3.js";
import { ENV, TokenListProvider } from "@solana/spl-token-registry";
import { none } from "@solana/options";
import * as dotenv from 'dotenv';

dotenv.config();
const rpc_uri: string = process.env.RPC_URI || "https://api.mainnet-beta.solana.com";

const socialLinks = ['discord', 'twitter', 'telegram', 'website', 'medium', 'reddit', 'facebook', 'instagram', 'github', 'tiktok'
  ,'snapchat', 'pinterest', 'slack', 'signal', 'wechat', 'youtube', 'twitch', 'vimeo', 'quora', 'dribble', 'behance', 'roblox', 'bluesky' 
];

export default async function getTokenMetadata(memeAccount : string) {
  const connection = new Connection(rpc_uri);
  const metaplex = Metaplex.make(connection);

  const mintAddress = new PublicKey(memeAccount);

  let tokenName;
  let tokenSymbol;
  let tokenLogo;

  const metadataAccount = metaplex
    .nfts()
    .pdas()
    .metadata({ mint: mintAddress });

    const metadataAccountInfo = await connection.getAccountInfo(metadataAccount);
    let existingLinksCount = 0;

    if (metadataAccountInfo) {
          const token = await metaplex.nfts().findByMint({ mintAddress: mintAddress });
          tokenName = token.name;
          tokenSymbol = token.symbol;
          tokenLogo = token.json?.image;
          existingLinksCount = socialLinks.filter(link => token.json?.[link]).length;

    }
    else {
        const provider = await new TokenListProvider().resolve();
        const tokenList = provider.filterByChainId(ENV.MainnetBeta).getList();
        console.log(tokenList)
        const tokenMap = tokenList.reduce((map, item) => {
          map.set(item.address, item);
          return map;
        }, new Map());

        const token = tokenMap.get(mintAddress.toBase58());
        tokenName = token.name;
        tokenSymbol = token.symbol;
        tokenLogo = token.logoURI;

        existingLinksCount = socialLinks.filter(link => token.extensions?.[link]).length;
    }
    console.log("number of the social sites", existingLinksCount);
    return existingLinksCount;
    
}
