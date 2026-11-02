// electron-builder afterPack hook: ad-hoc sign the macOS app.
// Packaging edits the Electron app after it was signed, which leaves an invalid signature, and Apple Silicon Macs
// then report a downloaded copy as "damaged and can't be opened". An ad-hoc signature fixes that (users still get
// the "unidentified developer" prompt). A paid Apple Developer ID + notarization would remove that prompt too.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};
