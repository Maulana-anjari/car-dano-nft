import express from 'express';
import swaggerUi from 'swagger-ui-express';
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

// 1. USE ENVIRONMENT VARIABLES
const blockfrostApiKey = process.env.BLOCKFROST_API_KEY || "previewXbDbd9sb7sZVQgdjypsxgVRFvZEGhdQK"; // Fallback for development
const blockchainProvider = new BlockfrostProvider(blockfrostApiKey);

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

// Swagger UI setup (same as your original code)
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'NFT Metadata API',
    version: '1.0.0',
    description: 'API for submitting NFT metadata and retrieving transaction metadata',
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
    '/api/metadata/{txHash}': {
      get: {
        summary: 'Retrieve metadata for a transaction',
        parameters: [
          {
            in: 'path',
            name: 'txHash',
            required: true,
            schema: { type: 'string' },
            description: 'The transaction hash to retrieve metadata for'
          }
        ],
        responses: {
          '200': {
            description: 'Transaction metadata retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
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
    }
  }
};
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// POST endpoint to receive metadata and mint NFT
app.post('/api/metadata', async (req, res) => {
  const metadata = req.body;

  if (!metadata.vehicleNumber || !metadata.inspectionDate || !metadata.inspectorId ||
      !metadata.mileage || !metadata.status || !metadata.pdfurl) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 2. & 3.  HASHING AND REMOVE ASSETS (These go together)
    const utxos = await wallet.getUtxos();
    const walletAddress = (await wallet.getUsedAddresses())[0];
    const forgingScript = ForgeScript.withOneSignature(walletAddress); // Keep original policy
    const policyId = resolveScriptHash(forgingScript);

    // Generate unique token name using SHA-256 hashing
    const hash = createHash('sha256');
    const dataToHash = `${metadata.vehicleNumber}-${metadata.inspectionDate}-${metadata.inspectorId}`;
    hash.update(dataToHash);
    const tokenName = hash.digest('hex').substring(0, 32); // Truncate to 32 bytes
    const tokenNameHex = stringToHex(tokenName);
    const assetId = policyId + tokenNameHex;
    const nftMetadata = { [policyId]: { [tokenName]: { ...metadata,  name: `CarInspection-${tokenName}` } } };

    const txBuilder = getTxBuilder();

    // Remove the 'assets' array.  MeshTxBuilder handles UTXO.
    const unsignedTx = await txBuilder
      .mint("1", policyId, tokenNameHex)
      .mintingScript(forgingScript)
      .metadataValue(721, nftMetadata)
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .complete();

    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

    res.json({ txHash, assetId }); // Return txHash

  } catch (error) {
    console.error(error);
     res.status(500).json({ error: 'Failed to mint NFT', details: error.message }); // Improved error
  }
});

// GET endpoint (USE ENVIRONMENT VARIABLE)
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
     res.status(500).json({ error: 'Failed to retrieve transaction metadata', details:error.message }); // Improved error

  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Swagger UI available at http://localhost:${port}/api-docs`);
});