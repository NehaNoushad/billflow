import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { seedDatabase, DEMO_PASSWORD } from "@/services/seed";

async function main() {
  await connectDB();
  console.log(`Seeding ${process.env.MONGODB_URI?.replace(/\/\/[^@]*@/, "//***@")}`);
  await seedDatabase((msg) => console.log(`  ${msg}`));
  console.log(`\nDemo logins (password: ${DEMO_PASSWORD})`);
  console.log("  admin@billflow.demo     ADMIN");
  console.log("  staff@billflow.demo     STAFF");
  console.log("  customer@billflow.demo  CUSTOMER");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
