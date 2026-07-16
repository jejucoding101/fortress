import fs from "node:fs";
import path from "node:path";

const [command, ...args] = process.argv.slice(2);

const aliases = {
  home: process.env.USERPROFILE ?? process.env.HOME ?? "",
  codex: path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex"),
  "codex-skill": path.join(
    process.env.USERPROFILE ?? process.env.HOME ?? "",
    ".codex",
    "plugins",
    "cache",
    "openai-curated-remote"
  )
};

function resolveAliasPath(alias, parts) {
  const root = aliases[alias];
  if (!root) {
    throw new Error(`Unknown alias: ${alias}`);
  }
  return path.join(root, ...parts);
}

function usage() {
  console.error("Usage:");
  console.error("  node scripts/unicode-path.mjs print <alias> <path...>");
  console.error("  node scripts/unicode-path.mjs exists <alias> <path...>");
  console.error("  node scripts/unicode-path.mjs list <alias> <path...>");
  console.error("Aliases: home, codex, codex-skill");
}

try {
  if (!command) {
    usage();
    process.exit(1);
  }

  const [alias, ...parts] = args;
  if (!alias) {
    usage();
    process.exit(1);
  }

  const target = resolveAliasPath(alias, parts);

  if (command === "exists") {
    console.log(fs.existsSync(target) ? "true" : "false");
  } else if (command === "print") {
    process.stdout.write(fs.readFileSync(target, "utf8"));
  } else if (command === "list") {
    for (const item of fs.readdirSync(target, { withFileTypes: true })) {
      console.log(`${item.isDirectory() ? "dir " : "file"} ${item.name}`);
    }
  } else {
    usage();
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
