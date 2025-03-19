import { Asset, deserializeAddress, ForgeScript, resolveScriptHash, stringToHex  } from "@meshsdk/core";

import fs from "node:fs";
import {
  BlockfrostProvider,
  MeshTxBuilder,
  MeshWallet,
  UTxO,
} from "@meshsdk/core";
 
const blockchainProvider = new BlockfrostProvider("previewXbDbd9sb7sZVQgdjypsxgVRFvZEGhdQK");
// wallet for signing transactions
export const wallet = new MeshWallet({
  networkId: 0,
  fetcher: blockchainProvider,
  submitter: blockchainProvider,
  key: {
    type: "root",
    bech32: fs.readFileSync("me.sk").toString(),
  },
});

// reusable function to get a transaction builder
export function getTxBuilder() {
  return new MeshTxBuilder({
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
  });
}
   
  // reusable function to get a UTxO by transaction hash
export async function getUtxoByTxHash(txHash: string): Promise<UTxO> {
    const utxos = await blockchainProvider.fetchUTxOs(txHash);
    if (utxos.length === 0) {
      throw new Error("UTxO not found");
    }
    return utxos[0];
}
async function main() {
  // these are the assets we want to lock into the contract
  const assets: Asset[] = [
    {
      unit: "lovelace",
      quantity: "1000000",
    },
  ];
 
  // get utxo and wallet address
  const utxos = await wallet.getUtxos();
  const walletAddress = (await wallet.getUsedAddresses())[0];
  // ----
  const forgingScript = ForgeScript.withOneSignature(walletAddress);
  const demoAssetMetadata = {
    vehicleNumber: "AB1234CD",
    inspectionDate: "2025-03-19T10:30:00Z",
    inspectorId: "12345",
    mileage: "10000",
    status: "PASSED",
    pdfurl: "https://bitcoin.org/bitcoin.pdf"
  };
  const policyId = resolveScriptHash(forgingScript);
  const tokenName = "PT. Inspeksi Mobil Jogja";
  const tokenNameHex = stringToHex(tokenName);
  const metadata = { [policyId]: { [tokenName]: { ...demoAssetMetadata } } };
  
 
  // hash of the public key of the wallet, to be used in the datum
  const signerHash = deserializeAddress(walletAddress).pubKeyHash;
 
  // build transaction with MeshTxBuilder
  const txBuilder = getTxBuilder();
  /// ----
  const unsignedTx = await txBuilder
  .mint("1", policyId, tokenNameHex)
  .mintingScript(forgingScript)
  .metadataValue(721, metadata)
  .changeAddress(walletAddress)
  .selectUtxosFrom(utxos)
  .complete();

    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

  console.log(`1 NFT successfully minted at Tx ID: ${txHash}`);
}
 
main();