import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { Asset, deserializeAddress, ForgeScript, resolveScriptHash, stringToHex } from "@meshsdk/core";
import fs from "node:fs";
import {
  BlockfrostProvider,
  MeshTxBuilder,
  MeshWallet,
  UTxO,
} from "@meshsdk/core";
import fetch from 'node-fetch';

const app = express();
const port = 3000;

app.use(express.json());

// Blockchain setup
const blockchainProvider = new BlockfrostProvider("previewXbDbd9sb7sZVQgdjypsxgVRFvZEGhdQK");
const wallet = new MeshWallet({
  networkId: 0,
  fetcher: blockchainProvider,
  submitter: blockchainProvider,
  key: {
    type: "root",
    bech32: fs.readFileSync("me.sk").toString(),
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
                    txHash: { type: 'string' }
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
    const assets: Asset[] = [
      {
        unit: "lovelace",
        quantity: "1000000",
      },
    ];

    const utxos = await wallet.getUtxos();
    const walletAddress = (await wallet.getUsedAddresses())[0];
    const forgingScript = ForgeScript.withOneSignature(walletAddress);

    const policyId = resolveScriptHash(forgingScript);
    const tokenName = "PT. Inspeksi Mobil Jogja";
    const tokenNameHex = stringToHex(tokenName);
    const nftMetadata = { [policyId]: { [tokenName]: { ...metadata } } };

    const signerHash = deserializeAddress(walletAddress).pubKeyHash;
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

    res.json({ txHash });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to mint NFT' });
  }
});

// GET endpoint to retrieve transaction metadata from Blockfrost
app.get('/api/metadata/:txHash', async (req, res) => {
  const { txHash } = req.params;

  if (!txHash) {
    return res.status(400).json({ error: 'Transaction hash is required' });
  }

  try {
    const response = await fetch(`https://cardano-preview.blockfrost.io/api/v0/txs/${txHash}/metadata`, {
      headers: {
        'project_id': 'previewXbDbd9sb7sZVQgdjypsxgVRFvZEGhdQK' // Your Blockfrost API key
      }
    });

    if (!response.ok) {
      throw new Error(`Blockfrost API returned status ${response.status}`);
    }

    const metadata = await response.json();
    res.json(metadata);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to retrieve transaction metadata' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Swagger UI available at http://localhost:${port}/api-docs`);
});