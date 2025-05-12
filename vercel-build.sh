#!/bin/bash

# Build the frontend
echo "Building frontend with Vite..."
npx vite build

# Build the server files
echo "Building server files with esbuild..."
npx esbuild server/**/*.ts shared/**/*.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

# Copy shared modules
echo "Copying shared modules..."
cp -r shared dist/

# Since Vite builds to dist/public, we need to move it to dist/client for Vercel
echo "Organizing output for Vercel..."
if [ -d "dist/public" ]; then
  echo "Moving dist/public to dist/client..."
  mkdir -p dist/client
  cp -r dist/public/* dist/client/
else
  echo "ERROR: dist/public directory not found"
  ls -la dist
fi

# Display directory structure for debugging
echo "Build output structure:"
ls -la dist/
echo "Client directory content:"
ls -la dist/client || echo "ERROR: Client directory not found"

# Log completion
echo "Build completed successfully!"