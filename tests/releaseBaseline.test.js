import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  selectBaseline,
  verifiedBaseline,
} from "./releaseBaselineHelper.mjs";

function release(tag, draft = false) {
  return {
    tag_name: tag,
    draft,
    assets: ["release.json", "release.json.sig"].map((name) => ({
      name,
      size: 100,
      browser_download_url: `https://github.com/n1k0m0/MiniMail/releases/download/${tag}/${name}`,
    })),
  };
}
const list = (items) => Buffer.from(JSON.stringify(items));

test("CI selects the newest signed preview baseline and fails closed on invalid assets", () => {
  const items = [
    release("v0.1.0-rc.9"),
    release("v0.1.0-rc.22"),
    release("v0.1.0-rc.99", true),
  ];
  assert.equal(selectBaseline(list(items)), "v0.1.0-rc.22");
  assert.equal(selectBaseline(list([...items, release("v0.1.0")])), "v0.1.0");
  assert.equal(selectBaseline(list([])), "");
  for (const change of [
    (item) => {
      item.assets = [];
    },
    (item) => {
      item.assets[0].size = 65537;
    },
    (item) => {
      item.assets[1].browser_download_url =
        "https://other.example.test/release.json.sig";
    },
    (item) => {
      item.assets[0].browser_download_url =
        item.assets[0].browser_download_url.replace("rc.22", "rc.9");
    },
  ]) {
    const newest = release("v0.1.0-rc.22");
    change(newest);
    assert.throws(() => selectBaseline(list([release("v0.1.0-rc.9"), newest])));
  }
  assert.throws(() => selectBaseline(list({ releases: [] })));
  assert.throws(() => selectBaseline(Buffer.alloc(2 * 1024 * 1024 + 1)));
});

test("authenticated CI downloads still require the trusted signature, exact tag and pinned image", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const manifest = {
    format: 1,
    version: "0.1.0-rc.22",
    revision: "a".repeat(40),
    image: `ghcr.io/n1k0m0/minimail@sha256:${"b".repeat(64)}`,
  };
  const raw = Buffer.from(JSON.stringify(manifest));
  const signature = crypto.sign(null, raw, privateKey).toString("base64");
  assert.equal(
    verifiedBaseline(raw, signature, "v0.1.0-rc.22", publicKey),
    manifest.image,
  );
  assert.throws(() =>
    verifiedBaseline(raw, signature, "v0.1.0-rc.21", publicKey),
  );
  assert.throws(() =>
    verifiedBaseline(
      Buffer.from(raw.toString().replace("rc.22", "rc.23")),
      signature,
      "v0.1.0-rc.23",
      publicKey,
    ),
  );
  assert.throws(() => verifiedBaseline(raw, signature, "v0.1.0-rc.22"));
  const unpinned = Buffer.from(
    JSON.stringify({ ...manifest, image: "ghcr.io/n1k0m0/minimail:latest" }),
  );
  assert.throws(() =>
    verifiedBaseline(
      unpinned,
      crypto.sign(null, unpinned, privateKey).toString("base64"),
      "v0.1.0-rc.22",
      publicKey,
    ),
  );
});
