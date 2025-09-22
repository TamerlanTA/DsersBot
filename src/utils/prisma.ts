import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'query' }]
});

process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
