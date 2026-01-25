
process.env.DATABASE_URL = "postgresql://neondb_owner:npg_0iWHQMCtAmB8@ep-dry-bird-a4idwge9-pooler.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";
import { db } from './db';
console.log("Hello from trivial test with DB");
