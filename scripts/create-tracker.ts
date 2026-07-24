import path from "node:path";
import { createStarterTracker } from "../src/tracker.js";

await createStarterTracker(path.resolve("manual-files/wordpress-homepage-tracker.xlsx"));
console.log("Created manual-files/wordpress-homepage-tracker.xlsx");
