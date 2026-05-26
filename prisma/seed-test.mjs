// One-off seed for read-path testing — does NOT touch auth.
// Run with:  node prisma/seed-test.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const users = [
  {
    id: "test_alice",
    name: "Alice (test)",
    email: "alice@test.local",
    isPublic: true,
    profile: {
      categories: { Music: 40, Entertainment: 25, Gaming: 20, Education: 15 },
      topChannels: [
        { id: "UC_alice_1", name: "Lofi House",   thumbnail: "", videoCount: 412 },
        { id: "UC_alice_2", name: "Indie Radar",  thumbnail: "", videoCount: 188 },
      ],
      topKeywords: ["lofi", "indie folk", "live session", "soundtrack"],
      sampleVideoIds: ["a1", "a2", "a3"],
    },
  },
  {
    id: "test_bob",
    name: "Bob (test)",
    email: "bob@test.local",
    isPublic: true,
    profile: {
      categories: { "Science & Technology": 55, Education: 25, Music: 10, Gaming: 10 },
      topChannels: [
        { id: "UC_bob_1", name: "TechLoop Daily", thumbnail: "", videoCount: 612 },
      ],
      topKeywords: ["llm", "kubernetes", "rust", "indie folk"],
      sampleVideoIds: ["b1", "b2"],
    },
  },
  {
    id: "test_carol_private",
    name: "Carol (private)",
    email: "carol@test.local",
    isPublic: false,
    profile: {
      categories: { Gaming: 80, Entertainment: 20 },
      topChannels: [],
      topKeywords: ["elden ring"],
      sampleVideoIds: [],
    },
  },
];

for (const u of users) {
  await prisma.user.upsert({
    where: { id: u.id },
    update: { name: u.name, email: u.email, isPublic: u.isPublic },
    create: { id: u.id, name: u.name, email: u.email, isPublic: u.isPublic },
  });
  await prisma.algoProfile.upsert({
    where: { userId: u.id },
    update: {
      categories: JSON.stringify(u.profile.categories),
      topChannels: JSON.stringify(u.profile.topChannels),
      topKeywords: JSON.stringify(u.profile.topKeywords),
      sampleVideoIds: JSON.stringify(u.profile.sampleVideoIds),
      lastSyncedAt: new Date(),
    },
    create: {
      userId: u.id,
      categories: JSON.stringify(u.profile.categories),
      topChannels: JSON.stringify(u.profile.topChannels),
      topKeywords: JSON.stringify(u.profile.topKeywords),
      sampleVideoIds: JSON.stringify(u.profile.sampleVideoIds),
    },
  });
}

// Follow: alice → bob
await prisma.follow.upsert({
  where: { followerId_followingId: { followerId: "test_alice", followingId: "test_bob" } },
  update: {},
  create: { followerId: "test_alice", followingId: "test_bob" },
});

console.log("seeded:", users.map((u) => u.id).join(", "));
await prisma.$disconnect();
