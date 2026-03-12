#!/bin/bash

echo "Starting Hardhat node..."
npx hardhat node &

sleep 3

echo "Deploying contracts..."
npx hardhat run scripts/deploy.ts --network localhost
npx hardhat run scripts/deploy_tokens.ts --network localhost
npx hardhat run scripts/deploy_dex.ts --network localhost
npx hardhat run scripts/init_pools.ts --network localhost

echo "Starting backend..."
uvicorn ai-risk.api.main:app --reload --port 8787 &

echo "Starting frontend..."
cd frontend
npm run dev