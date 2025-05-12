// Vercel postbuild script
// This file should be run after the build process completes
// It will ensure that the client files are in the correct directory structure

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Running Vercel post-build organization script...');

// Define paths
const distPath = path.join(process.cwd(), 'dist');
const publicPath = path.join(distPath, 'public');
const clientPath = path.join(distPath, 'client');

// Check if the public directory exists
if (fs.existsSync(publicPath)) {
  console.log('Found dist/public directory');

  // Ensure client directory exists
  if (!fs.existsSync(clientPath)) {
    console.log('Creating dist/client directory...');
    fs.mkdirSync(clientPath, { recursive: true });
  }

  // Copy contents from public to client
  console.log('Copying files from dist/public to dist/client...');
  
  try {
    const files = fs.readdirSync(publicPath);
    
    for (const file of files) {
      const srcPath = path.join(publicPath, file);
      const destPath = path.join(clientPath, file);
      
      if (fs.statSync(srcPath).isDirectory()) {
        // If it's a directory, copy recursively
        execSync(`cp -r "${srcPath}" "${destPath}"`);
      } else {
        // If it's a file, copy it
        fs.copyFileSync(srcPath, destPath);
      }
    }
    
    console.log('Successfully copied files to dist/client');
  } catch (error) {
    console.error('Error copying files:', error);
  }
} else {
  console.log('dist/public directory not found, checking if dist/client exists');
  
  if (!fs.existsSync(clientPath)) {
    console.log('Creating dist/client directory and a placeholder file...');
    fs.mkdirSync(clientPath, { recursive: true });
    fs.writeFileSync(path.join(clientPath, 'index.html'), '<html><body><h1>Local Cooks Application</h1></body></html>');
  }
}

// Log directory structure for debugging
try {
  console.log('Final directory structure:');
  console.log('dist directory:');
  console.log(fs.readdirSync(distPath));
  
  console.log('client directory:');
  console.log(fs.readdirSync(clientPath));
} catch (error) {
  console.error('Error listing directories:', error);
}

console.log('Post-build organization completed');