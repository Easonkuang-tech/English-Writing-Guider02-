// Auto-bundled from data/prompts.md at 2026-09-20.
// This file replaces the /api/prompts endpoint so the static deployment does
// not need a backend to load the built-in IELTS writing prompt bank.
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const content = fs.readFileSync(path.join(root, "data", "prompts.md"), "utf8");
const out = path.join(root, "public", "prompts-data.mjs");
fs.writeFileSync(
  out,
  "// Auto-bundled from data/prompts.md.\n" +
  "// Replaces /api/prompts for static-only deployments.\n" +
  "export const PROMPTS_MARKDOWN = " + JSON.stringify(content) + ";\n" +
  "\nexport default PROMPTS_MARKDOWN;\n"
);
console.log("Wrote " + out + " (" + fs.statSync(out).size + " bytes)");
