// Stage 0 verification harness (see ../plans/stack-ribbon.md and ./README.md).
//
// Loads the real, unmodified extension source with a fixed extension key
// applied (so it gets a stable, predictable ID across runs, since the real
// unpacked install's ID is otherwise path-derived and unpredictable), seeds
// a disposable scratch Chrome profile with a READ-ONLY copy of the real
// extension's chrome.storage.local data, opens the dashboard against it,
// and screenshots the result.
//
// The real Chrome profile is only ever read from, never written to.

const { chromium } = require("playwright");
const path = require("path");
const os = require("os");
const fs = require("fs");

const REPO_ROOT = path.join(__dirname, "..");

// Real extension ID as installed unpacked in Scott's actual Chrome — used
// only to locate its storage folder. If FocusStream gets reinstalled from
// a different path, this ID changes; re-derive via chrome://extensions
// (Developer mode) and update here. See README.md "Known-good values".
const REAL_EXTENSION_ID = "hggaojjflbdigpmnpnjcojhccehnmjga";
const REAL_STORAGE_DIR = path.join(
  os.homedir(),
  "Library/Application Support/Google/Chrome/Default/Local Extension Settings",
  REAL_EXTENSION_ID
);

// Fixed key so the scratch-loaded copy always resolves to the same
// extension ID (proven 2026-08-11) -> FIXED_EXTENSION_ID below.
const FIXED_MANIFEST_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3I/4ApBmRzzF5GlncGJvARmBfwjtEivwKi91907Ox9MwINM/uH1KngpDVjq025y/sY8DUx5E+23jtIwiEUEVYQfZ25SWEHMRrYHj4FTpoiJZi+C9M9p/vvVpk+PiwVbrfEvvwjcm1QD/CYROwgEsvWvT3XDWcyow3T7VqqBlCzVRaI9UKzCnOp/Ktrsm0ClBx/CSQabqty9ThDGPZ4hiujT4WA8QAdn9eyCMDPCVk3xk3oBZRiwKZemh6ZFitMA6gwOnnHwKP0+CwLB6o94SbwxGmy6oTSpGqq2X3Has4e70Vi3pvXVUuSYpjws/4WN28fVo+fLWdG/wkfg+oj4ovwIDAQAB";
const FIXED_EXTENSION_ID = "ciolidkleekeofbmhldgaldhpmflnmkl";

function copyDirSync(src, dest, { skip = [] } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d, { skip });
    else fs.copyFileSync(s, d);
  }
}

(async () => {
  // 1. Build a throwaway copy of the real extension source with the fixed
  //    key spliced into its manifest. Copying (not symlinking) keeps
  //    Chrome, which can be picky about symlinked extension dirs, simple.
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-pw-extbuild-"));
  copyDirSync(REPO_ROOT, buildDir, {
    skip: [".git", "testing", "plans", "decisions", "node_modules"],
  });
  const manifest = JSON.parse(
    fs.readFileSync(path.join(buildDir, "manifest.json"), "utf8")
  );
  manifest.key = FIXED_MANIFEST_KEY;
  fs.writeFileSync(
    path.join(buildDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  // 2. Seed a fresh scratch Chrome profile with a read-only copy of the
  //    real extension's storage, filed under the fixed extension ID.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-pw-profile-"));
  const destStorageDir = path.join(
    userDataDir,
    "Default",
    "Local Extension Settings",
    FIXED_EXTENSION_ID
  );
  if (!fs.existsSync(REAL_STORAGE_DIR)) {
    throw new Error(
      `Real extension storage not found at ${REAL_STORAGE_DIR}. ` +
        `Extension ID may have changed — see README.md.`
    );
  }
  copyDirSync(REAL_STORAGE_DIR, destStorageDir);
  console.log("Seeded scratch profile from real storage:", REAL_STORAGE_DIR);

  // 3. Launch, verify the ID matched (i.e. the copied storage will
  //    actually be found), open the dashboard, screenshot it.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${buildDir}`,
      `--load-extension=${buildDir}`,
    ],
  });

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
  }
  const loadedId = worker.url().split("/")[2];
  if (loadedId !== FIXED_EXTENSION_ID) {
    await context.close();
    throw new Error(
      `Loaded extension ID (${loadedId}) does not match fixed ID ` +
        `(${FIXED_EXTENSION_ID}) — copied storage will not be found. ` +
        `The fixed key's derived ID may have changed; see README.md.`
    );
  }
  console.log("Loaded extension ID matches fixed ID:", loadedId);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${loadedId}/dashboard/index.html`);
  await page.waitForTimeout(2000); // let dashboard JS render real data

  const shotPath = path.join(__dirname, "dashboard-real-data.png");
  await page.screenshot({ path: shotPath, fullPage: true });
  console.log("Screenshot saved:", shotPath);

  await context.close();
})().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
