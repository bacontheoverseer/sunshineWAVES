import path from "path";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "zlib";
import crypto from "crypto";
import JavaScriptObfuscator from "javascript-obfuscator";

const { obfuscate } = JavaScriptObfuscator;

const CONFIG = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: true,
  identifierNamesGenerator: "mangled",
  log: false,
  renameGlobals: true,
  renameVariables: true,
  selfDefending: false,
  stringArray: false,
  splitStrings: false,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

const SW_MODULES = [
  "constants.js",
  "state.js",
  "init.js",
  "utils.js",
  "decode.js",
  "adblock.js",
  "inject.js",
  "network.js",
  "messaging.js",
  "handler.js",
];

export default function sunshinePlugin() {
  const buildId = crypto.createHash("sha1").update(Date.now() + Math.random().toString()).digest("hex").slice(0, 8);
  let distDir;
  let swSrcDir;
  let projectRoot;

  return {
    name: "sunshine-build",
    enforce: "post",

    configResolved(config) {
      distDir = path.resolve(config.root, config.build.outDir);
      swSrcDir = path.join(config.root, "b", "sw");
      projectRoot = path.resolve(config.root, "..");
    },

    async writeBundle(_options, bundle) {
      const precacheAssets = [];
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (!fileName.startsWith("assets/")) continue;
        if (
          (chunk.type === "chunk" && fileName.endsWith(".js")) ||
          (chunk.type === "asset" && fileName.endsWith(".css"))
        ) {
          precacheAssets.push("/" + fileName);
        }
      }

      const modSources = await Promise.all(
        SW_MODULES.map((mod) => readFile(path.join(swSrcDir, mod), "utf8")),
      );
      let swCode = modSources.join("\n");
      swCode = swCode
        .replace(/__BUILD_ID__/g, buildId)
        .replace(
          /(['"])__PRECACHE_ASSETS__\1/g,
          JSON.stringify(precacheAssets),
        );

      const swObf = obfuscate(swCode, CONFIG).getObfuscatedCode();
      const swHash = crypto.createHash("md5")
        .update(swObf)
        .digest("hex")
        .slice(0, 10);
      const swFileName = `b/${swHash}.js`;

      // Ensure b directory exists
      await mkdir(path.join(distDir, "b"), { recursive: true });

      await writeFile(path.join(distDir, "build-meta.json"), JSON.stringify({ build: buildId }));
      await writeFile(path.join(distDir, swFileName), swObf);

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        const filePath = path.join(distDir, fileName);
        let code;
        try {
          code = await readFile(filePath, "utf8");
        } catch {
          continue;
        }

        code = obfuscate(code, {
          ...CONFIG,
          reservedStrings: ["./b/sw.js", "/b/sw.js"],
        }).getObfuscatedCode();

        code = code
          .replace(/(['"`])\.\/b\/sw\.js\1/g, `$1./${swFileName}$1`)
          .replace(/(['"`])\/b\/sw\.js\1/g, `$1/${swFileName}$1`);

        await writeFile(filePath, code);
      }

      const compressJobs = [];

      async function scanDir(dir) {
        const entries = await readdir(dir, { withFileTypes: true });
        await Promise.all(
          entries.map(async (entry) => {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await scanDir(fullPath);
            } else if (/\.(js|css|html|mjs)$/.test(entry.name)) {
              const buf = await readFile(fullPath);
              compressJobs.push(
                Promise.resolve().then(async () => {
                  const br = brotliCompressSync(new Uint8Array(buf), {
                    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
                  });
                  await writeFile(fullPath + ".br", br);
                }),
                Promise.resolve().then(async () => {
                  const gz = gzipSync(buf, { level: 9 });
                  await writeFile(fullPath + ".gz", gz);
                }),
              );
            }
          }),
        );
      }

      const bundleInputs = [
        path.join(projectRoot, "node_modules", "@mercuryworkshop", "bare-mux", "dist", "index.js"),
        path.join(distDir, "..", "public", "b", "s", "jetty.all.js"),
        path.join(distDir, "..", "public", "b", "u", "bunbun.js"),
        path.join(distDir, "..", "public", "b", "u", "concon.js"),
      ];
      const pieces = [];
      for (const p of bundleInputs) {
        try {
          let code = await readFile(p, "utf8");
          code = code.replace(/\r\n/g, "\n");
          code = code.replace(/^\/\/# sourceMappingURL=.*$/gm, "").trim();
          pieces.push(code);
        } catch {}
      }
      if (pieces.length > 0) {
        await writeFile(path.join(distDir, "b", "all.js"), pieces.join(";\n"));
      }

      await scanDir(distDir);
      await Promise.all(compressJobs);

      console.log(`\nbuild id:  ${buildId}`);
      console.log(`sw:        /${swFileName}`);
      console.log(`bundle:    ${pieces.length === 4 ? "concatenated" : pieces.length + "/4"}`);
      console.log(`precache:  ${precacheAssets.length} asset(s)`);
    },
  };
}
