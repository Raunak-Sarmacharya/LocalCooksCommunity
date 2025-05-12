#!/bin/bash

# Build the frontend
echo "Building frontend..."
npx vite build

# Build the server files
echo "Building server files..."
npx esbuild server/**/*.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

# Ensure we have the right directory structure
echo "Verifying directory structure..."
mkdir -p dist/client

# Log completion
echo "Build completed successfully!"