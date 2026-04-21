# AI Smart Wallet

An AI-enhanced smart contract wallet built on top of ERC-4337 account abstraction.

This project extends the `eth-infinitism/account-abstraction` framework into an **AI Smart Wallet** that combines modular smart contract wallet logic, AI-based transaction risk analysis, LLM-powered wallet assistance, and local swap interaction in a unified system.

While the core ERC-4337 account abstraction logic is inherited from the upstream implementation, the wallet-specific extensions, AI integration, frontend workflow, and risk validation pipeline were developed in this project.


## Overview

Traditional wallets mainly execute user instructions, but they do not actively help users understand transaction risk, validate intent, or provide contextual guidance during wallet operations.

This project explores how AI can be integrated into a smart contract wallet to make wallet interaction:

- **more understandable**, through concise page-aware AI explanations

- **safer**, through transaction risk scoring and on-chain validation

- **more modular**, through extensible wallet architecture and validation components

The resulting prototype combines:

- **ERC-4337 smart accounts**

- **MetaMask-based EOA signing**

- **AI-powered transfer risk scoring**

- **LLM-based user-facing explanations**

- **on-chain enforcement via oracle**

- **swap interaction in a local demo environment**

- **ERC-4337 smart accounts**

- **MetaMask-based EOA signing**

- **AI-powered transfer risk scoring**

- **LLM-based user-facing explanations**

- **on-chain enforcement via oracle**

- **swap interaction in a local demo environment**

- **iInteract with DAO governance proposals**

- **future-ready authentication design for Passkey and OAuth**



## Key Features

### ERC-4337 Smart Account Wallet

- Built on top of the `eth-infinitism/account-abstraction` project

- Uses account abstraction for user operation handling and smart account execution

- Demonstrates how AI can be integrated into a programmable wallet flow

### AI-Based Transaction Risk Detection

- Transfer transactions are evaluated by a trained **XGBoost** model

- The backend produces a risk score and explanation metadata

- The wallet can use this evaluation result for frontend warnings and validation-related enforcement 

### LLM-Powered Wallet Assistant

- Uses the OpenAI API for user-facing explanations

- Provides concise, page-specific assistance based on the current wallet state

- Helps users understand transactions, warnings, and wallet behavior during interaction

### On-Chain Validation

- Oracle / issuer signatures are verified on-chain

- Validation logic is integrated through the wallet’s validation facet


### Swap Demo Flow

- Includes token deployment, DEX deployment, and pool initialization for local testing

- Extends the wallet beyond simple transfer-only scenarios

### DAO Governance Interaction

- Supports interaction with DAO governance workflows in the wallet interface
- Includes proposal-related actions such as viewing proposals and voting

### Frontend Wallet Interface

- Includes wallet interaction pages such as login, transfer, swap, history, and proposal-related flows

- Integrates a chatbot assistant into the wallet UI

### Authentication Design

- **MetaMask-based connection is implemented**，MetaMask is just used as a signer to authorize the smart account, rather than acting as the wallet itself

- **Passkey** and **OAuth** currently exist as **placeholder modes**

- Trusted issuer signing and issuer-signature verification in the ValidationFacet are already implemented


## Contribution Scope

This repository is based on a fork of:

- `eth-infinitism/account-abstraction`

The upstream project provides the ERC-4337 foundation, including core account abstraction logic and related infrastructure.

This project extends that base with:

- AI-assisted wallet interaction

- transaction risk scoring with XGBoost

- LLM-based explanations

- oracle / issuer-attested transaction validation

- wallet frontend integration

- local swap testing flow

- authentication extensions for future login modes

In short:

- **ERC-4337 core logic** comes from the upstream fork

- **AI wallet functionality and custom integration work** are the main contribution of this project


## Tech Stack

### Blockchain / Smart Contract

- Solidity

- Hardhat

- ERC-4337

- ERC-2535 Diamond Standard

### Frontend

- React

- TypeScript

- Vite

### Backend / AI

- FastAPI

- Python

- XGBoost

- OpenAI API



## Repository Structure

```text
.

├── ai-risk/ # AI risk scoring model, API, and model artifacts

├── contracts/ # Smart contracts and wallet logic

├── deploy/ # Deployment-related files

├── frontend/ # Frontend wallet application

├── scripts/ # Hardhat deployment and local setup scripts

├── services/ # Additional service modules

└── README.md
```
  
## The project is mainly split into:

- `contracts/` for on-chain wallet and validation logic

- `ai-risk/` for model inference and risk evaluation

- `frontend/` for wallet UI and interaction flow

- `scripts/` for local deployment and test setup



## Implemented Features 

- MetaMask connection

- EOA-based signing flow for the smart account

- ERC-4337 smart account integration

- AI transfer risk inference

- Oracle signing flow

- Validation facet issuer/signature verification

- Frontend wallet interaction

- Local swap-related contracts and test flow

- GPT-based chatbot explanations



## AI Risk Model

The transaction risk engine is based on a pre-trained **XGBoost** model.

For transfer-related transactions, the backend extracts transaction features and performs inference to produce:

- a risk score

- explanation metadata / risk reason

- validation-related context for frontend display and on-chain enforcement



### Default Model

The default model loaded by the system is:

- `ai-risk/models/model_transfer_0005.json`

with metadata:

- `ai-risk/models/model_transfer_0005.meta.json`

These model artifacts are loaded automatically by the FastAPI backend.

### Important Note

Users do **not** need to retrain the model in order to run the project locally.

The repository uses a pre-trained model for inference.




  

## LLM Assistant

The wallet assistant uses the OpenAI API to generate short, user-facing explanations.

Current configuration uses:

```env
OPENAI_CHAT_MODEL=gpt-4.1
```

The assistant is designed to:  
  
- explain wallet actions in concise language  
- provide page-specific guidance  
- help users understand transaction outcomes and warnings  
- reduce confusion during wallet interaction



## Prerequisites  
  
Before running the project, make sure you have:  
  
- **Node.js** and **npm**  
- **Python 3**  
- **MetaMask**  
- a local environment capable of running Hardhat and FastAPI



#### Installation

Install JavaScript dependencies from the project root:

```bash
npm install
```

If your frontend requires a separate installation step, install dependencies inside `frontend/` as well:

```bash
cd frontend  
npm install  
cd ..
```

Install Python dependencies for the AI risk API in your Python environment:

```bash
pip install -r ai-risk/api/requirements.txt
```

If your local Python setup differs, install the dependencies required by the `ai-risk/api` service before starting FastAPI.



## Environment Configuration

Create the environment file for the AI risk API at:

```
ai-risk/api/.env
```

Example configuration:

```.env
ORACLE_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a  
CHAIN_ID=31337  
MODEL_PATH=ai-risk/models/model_transfer_0005.json  
MODEL_META_PATH=ai-risk/models/model_transfer_0005.meta.json  
ORACLE_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a  
OPENAI_CHAT_MODEL=gpt-4.1
```

### Notes

- `CHAIN_ID=31337` is used for the local Hardhat network
- `MODEL_PATH` and `MODEL_META_PATH` point to the default XGBoost model artifacts
- `OPENAI_CHAT_MODEL` specifies the LLM used by the wallet assistant
- the oracle private key shown above is intended for local demo/testing usage

If your OpenAI integration also requires an API key, add it to the same `.env` file according to your backend implementation.



## Default Local Accounts

The local Hardhat setup uses the following accounts in the current prototype:
### EOA used to sign for the Smart Account

- **Account #1**
- `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
### Oracle signing account

- **Account #2**
- `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`

These accounts are intended for local development and demonstration only.



## Startup Order

Start the services in the following order.

### 1. Start the local Hardhat node

```bash
npx hardhat node
```

### 2. Deploy the Smart Account and swap-related contracts

```bash
npx hardhat run scripts/deploy.ts --network localhost  
npx hardhat run scripts/deploy_tokens.ts --network localhost  
npx hardhat run scripts/deploy_dex.ts --network localhost  
npx hardhat run scripts/init_pools.ts --network localhost
```
This deploys:

- smart account related contracts
- local test tokens
- DEX contracts
- liquidity pools for swap testing

### 3. Start the AI risk FastAPI service

```bash
uvicorn main:app --app-dir ai-risk/api --host 127.0.0.1 --port 8787 --reload --env-file ai-risk/api/.env
```

### 4. Start the frontend

```bash
npm run dev
```



## Contract and Model Synchronization

In the current prototype:

- deployed contract addresses are synchronized automatically
- model artifacts are stored automatically
- the backend loads `model_transfer_0005.json` by default



## MetaMask Setup

To use the implemented login flow, connect MetaMask to the local Hardhat network.

Typical local configuration:

- **Network Name**: Hardhat Local
- **RPC URL**: `http://127.0.0.1:8545`
- **Chain ID**: `31337`
- **Currency Symbol**: `ETH`

You may also need to import the corresponding Hardhat test accounts into MetaMask for local signing and testing.


## Notes on Model Training

The transfer risk model was trained offline using **XGBoost**.

For normal project usage:

- users do **not** need to retrain the model
- only the inference API needs to be started
- the pre-trained model is loaded automatically



## Acknowledgements / Upstream

This project builds on top of the excellent work from:

- `eth-infinitism/account-abstraction`

The upstream project provides the ERC-4337 account abstraction foundation used in this repository.

This repository is a fork-based extension for dissertation purposes, and all AI-wallet-specific modules, frontend integration, risk evaluation flow, validation extensions, and wallet interaction design were developed on top of that base.



## License

Please refer to the license information in this repository and the upstream project where applicable.