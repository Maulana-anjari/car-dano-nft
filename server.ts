import express from 'express';
import path from 'path'; 
import {
  deserializeAddress,
  ForgeScript,
  resolveScriptHash,
  stringToHex,
} from "@meshsdk/core";
import fs from "node:fs";
import {
  BlockfrostProvider,
  MeshTxBuilder,
  MeshWallet,
  UTxO,
} from "@meshsdk/core";
import fetch from 'node-fetch';
import { createHash } from 'crypto'; // Import for hashing

const app = express();
const port = 3000;

app.use(express.json());

// Blockchain setup - USE ENVIRONMENT VARIABLES IN PRODUCTION
const blockfrostApiKey = process.env.BLOCKFROST_API_KEY || "previewXbDbd9sb7sZVQgdjypsxgVRFvZEGhdQK"; // Fallback for development
const blockchainProvider = new BlockfrostProvider(blockfrostApiKey);

// Wallet setup - USE SECURE KEY MANAGEMENT IN PRODUCTION
const secretKey = process.env.WALLET_SECRET_KEY || fs.readFileSync("me.sk").toString(); // Fallback for development
const wallet = new MeshWallet({
    networkId: 0,
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
    key: {
        type: "root",
        bech32: secretKey,
    },
});

function getTxBuilder() {
  return new MeshTxBuilder({
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
  });
}

// Swagger UI setup
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'NFT Metadata API',
    version: '1.0.0',
    description: 'API for submitting NFT metadata, retrieving transaction metadata, and retrieving NFT data by Asset ID',
  },
  servers: [{ url: `http://localhost:${port}` }],
  paths: {
    '/api/metadata': {
      post: {
        summary: 'Submit NFT metadata and mint NFT',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  vehicleNumber: { type: 'string' },
                  inspectionDate: { type: 'string' },
                  inspectorId: { type: 'string' },
                  mileage: { type: 'string' },
                  status: { type: 'string' },
                  pdfurl: { type: 'string' }
                },
                required: ['vehicleNumber', 'inspectionDate', 'inspectorId', 'mileage', 'status', 'pdfurl']
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'NFT minted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    txHash: { type: 'string' },
                    assetId: {type: 'string'}
                  }
                }
              }
            }
          },
          '400': { description: 'Invalid metadata' },
          '500': { description: 'Minting failed' }
        }
      }
    },
    '/api/metadata/{txHash}': { // Keep for compatibility
      get: {
        summary: 'Retrieve metadata for a transaction (by Transaction Hash)',
        parameters: [
          {
            in: 'path',
            name: 'txHash',
            required: true,
            schema: { type: 'string' },
            description: 'The transaction hash'
          }
        ],
        responses: {
          '200': {
            description: 'Transaction metadata retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'array', // Blockfrost returns an array
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      json_metadata: { type: 'object' }
                    }
                  }
                }
              }
            }
          },
          '400': { description: 'Invalid transaction hash' },
          '500': { description: 'Failed to retrieve metadata' }
        }
      }
    },
    '/api/nft/{assetId}': { // NEW ENDPOINT (Retrieve by Asset ID)
      get: {
        summary: 'Retrieve NFT data by Asset ID',
        parameters: [
          {
            in: 'path',
            name: 'assetId',
            required: true,
            schema: { type: 'string' },
            description: 'The Asset ID of the NFT'
          }
        ],
        responses: {
          '200': {
            description: 'NFT data retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object', // Adjust as needed based on your desired output
                }
              }
            }
          },
          '400': { description: 'Invalid Asset ID' },
          '500': { description: 'Failed to retrieve NFT data' }
        }
      }
    }
  }
};

// POST endpoint to receive metadata and mint NFT
app.post('/api/metadata', async (req, res) => {
  const metadata = req.body;

  if (!metadata.vehicleNumber || !metadata.inspectionDate || !metadata.inspectorId ||
      !metadata.mileage || !metadata.status || !metadata.pdfurl) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const utxos = await wallet.getUtxos();
    const walletAddress = (await wallet.getUsedAddresses())[0];

    // Use the ORIGINAL one-signature forging script:
    const forgingScript = ForgeScript.withOneSignature(walletAddress);
    const policyId = resolveScriptHash(forgingScript);

    // Generate a unique token name (hashing)
    const hash = createHash('sha256');
    const dataToHash = `${metadata.vehicleNumber}-${metadata.inspectionDate}-${metadata.inspectorId}`;
    hash.update(dataToHash);
    const tokenName = hash.digest('hex').substring(0, 32);
    const tokenNameHex = stringToHex(tokenName);
    const assetId = policyId + tokenNameHex;
    const displayName = `CarInspection-${metadata.vehicleNumber}`;

    const nftMetadata = { [policyId]: { [tokenName]: { ...metadata,  name: displayName } } };

    const txBuilder = getTxBuilder();

    const unsignedTx = await txBuilder
      .mint("1", policyId, tokenNameHex)
      .mintingScript(forgingScript)
      .metadataValue(721, nftMetadata)
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .complete();

    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

    res.json({ txHash, assetId });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to mint NFT', details: error.message });
  }
});

// GET endpoint to retrieve transaction metadata from Blockfrost (by txHash)
app.get('/api/metadata/:txHash', async (req, res) => {
  const { txHash } = req.params;

  if (!txHash) {
    return res.status(400).json({ error: 'Transaction hash is required' });
  }

  try {
    const response = await fetch(`https://cardano-preview.blockfrost.io/api/v0/txs/${txHash}/metadata`, {
      headers: {
        'project_id': blockfrostApiKey // Use the environment variable
      }
    });

    if (!response.ok) {
      throw new Error(`Blockfrost API returned status ${response.status}`);
    }

    const metadata = await response.json();
    res.json(metadata);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to retrieve transaction metadata', details: error.message });
  }
});

// NEW GET endpoint to retrieve NFT data by Asset ID
app.get('/api/nft/:assetId', async (req, res) => {
    const { assetId } = req.params;

    if (!assetId) {
        return res.status(400).json({ error: 'Asset ID is required' });
    }

    try {
        // Get basic asset information
        const assetResponse = await fetch(`https://cardano-preview.blockfrost.io/api/v0/assets/${assetId}`, {
            headers: {
                'project_id': blockfrostApiKey
            }
        });

        if (!assetResponse.ok) {
            throw new Error(`Blockfrost API returned status ${assetResponse.status}`);
        }
        const assetData = await assetResponse.json();

        // Get on-chain metadata
        const metadataResponse = await fetch(`https://cardano-preview.blockfrost.io/api/v0/assets/${assetId}`, {
            headers: {
                'project_id': blockfrostApiKey
            }
        });

        if (!metadataResponse.ok) {
            throw new Error(`Blockfrost API returned status ${metadataResponse.status}`);
        }
        const metadataData = await metadataResponse.json();
        // Combine the responses (optional, but often useful)
        const combinedData = {
          ...assetData,
          metadata: metadataData, // Or structure this as you see fit
        };

        res.json(combinedData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to retrieve NFT data', details: error.message });
    }
});

app.get('/api-docs', (req, res) => { // Or choose another path like /reference
  res.sendFile(path.join(__dirname, 'scalar-docs.html'));
});

app.get('/openapi.json', (req, res) => {
  res.json(swaggerDocument); // Serve your existing swaggerDocument object
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Scalar API Reference available at http://localhost:${port}/api-docs`);
});