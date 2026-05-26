import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, googleId: true }
  })
  console.log('Users:', JSON.stringify(users, null, 2))

  const accounts = await prisma.account.findMany({
    select: { userId: true, provider: true, providerAccountId: true }
  })
  console.log('Accounts:', JSON.stringify(accounts, null, 2))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
