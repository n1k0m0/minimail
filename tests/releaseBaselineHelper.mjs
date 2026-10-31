import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  matchingReleaseAsset,
  verifyRelease,
} from "../server/updates.js";

const tagPattern =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$/;
const limits = { "release.json": 65536, "release.json.sig": 256 };

export function selectBaseline(raw) {
  if (raw.length > 2 * 1024 * 1024)
    throw new Error("Release list exceeds limit");
  const list = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(list)) throw new Error("Invalid release list");
  const release = list
    .filter((item) => item?.draft === false && tagPattern.test(item.tag_name))
    .sort((a, b) =>
      compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)),
    )[0];
  if (!release) return "";
  const base = `https://github.com/n1k0m0/MiniMail/releases/download/${release.tag_name}/`;
  for (const [name, limit] of Object.entries(limits))
    if (
      !Array.isArray(release.assets) ||
      !release.assets.some(
        (asset) =>
          asset.name === name &&
          Number.isSafeInteger(asset.size) &&
          asset.size > 0 &&
          asset.size <= limit &&
          matchingReleaseAsset(asset.browser_download_url, base + name),
      )
    )
      throw new Error("Latest release has no valid signed update assets");
  return release.tag_name;
}

export function verifiedBaseline(raw, signature, tag, key) {
  if (!tagPattern.test(tag)) throw new Error("Invalid baseline tag");
  const release = verifyRelease(raw, signature.toString("utf8"), key);
  if (`v${release.version}` !== tag)
    throw new Error("Signed baseline tag differs");
  return release.image;
}

function readBounded(filename, limit) {
  const info = fs.lstatSync(filename);
  if (!info.isFile() || info.size > limit)
    throw new Error("Invalid baseline file");
  return fs.readFileSync(filename);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const [mode, source, tag] = process.argv.slice(2);
    if (mode === "select")
      console.log(selectBaseline(readBounded(source, 2 * 1024 * 1024)));
    else if (mode === "verify")
      console.log(
        verifiedBaseline(
          readBounded(
            path.join(source, "release.json"),
            limits["release.json"],
          ),
          readBounded(
            path.join(source, "release.json.sig"),
            limits["release.json.sig"],
          ),
          tag,
        ),
      );
    else throw new Error("Unknown baseline operation");
  } catch {
    console.error(
      "Signed release baseline could not be verified; update tests stopped.",
    );
    process.exitCode = 1;
  }
}
