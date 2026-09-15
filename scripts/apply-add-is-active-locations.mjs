import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Client } = pg;

// Read .env file
const envPath = path.resolve('.env');
const envConfig = fs.readFileSync(envPath, 'utf-8')
    .split('\n')
    .find(line => line.startsWith('DATABASE_URL='));
const dbUrl = envConfig ? envConfig.split('=')[1].trim() : null;

if (!dbUrl) {
    console.error("DATABASE_URL not found in .env");
    process.exit(1);
}

const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    try {
        await client.query(`ALTER TABLE locations ADD COLUMN is_active BOOLEAN DEFAULT TRUE NOT NULL;`);
        console.log("Successfully added is_active column to locations table.");
    } catch (e) {
        if (e.message && e.message.includes("already exists")) {
            console.log("Column is_active already exists.");
        } else {
            console.error("Error migrating:", e);
        }
    } finally {
        await client.end();
    }
}
main();
