import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'schema.prisma',
  datasourceUrl: process.env.DATABASE_URL,
  prismaClient: {
    engineType: 'binary',
  },
});
