import path from "node:path";
import { createStarterTracker } from "../src/tracker/store.js";

const output = path.resolve(process.argv[2] ?? "manual-files/wordpress-homepage-tracker.xlsx");
await createStarterTracker(output);
process.stdout.write(`Created ${output}\n`);
