// exFAT has no hard links. dsh publishes new files with link(tmp, final),
// which only needs "create final, never clobber". When the filesystem
// refuses to link, fall back to an exclusive copy with the same contract.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const { link, linkSync } = fs;
const linkAsync = fs.promises.link;
const { COPYFILE_EXCL } = fs.constants;
const passThrough = (error) => error.code === "EEXIST" || error.code === "ENOENT";

fs.promises.link = async (existing, target) => {
  try {
    return await linkAsync(existing, target);
  } catch (error) {
    if (passThrough(error)) throw error;
    await fs.promises.copyFile(existing, target, COPYFILE_EXCL).catch(() => { throw error; });
  }
};
fs.linkSync = (existing, target) => {
  try {
    return linkSync(existing, target);
  } catch (error) {
    if (passThrough(error)) throw error;
    try { fs.copyFileSync(existing, target, COPYFILE_EXCL); } catch { throw error; }
  }
};
fs.link = (existing, target, callback) => {
  fs.promises.link(existing, target).then(() => callback(null), callback);
};
syncBuiltinESMExports();
