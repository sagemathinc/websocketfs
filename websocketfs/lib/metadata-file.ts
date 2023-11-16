import debug from "debug";
import { stat, readFile } from "fs/promises";
import { decode } from "lz4";
import binarySearch from "binarysearch";
import { symbolicToMode } from "./util";
import { join } from "path";

const log = debug("websocketfs:metadata-file");

const METADATA_FILE_INTERVAL_MS = 3000;

export class MetadataFile {
  private attrCache;
  private dirCache;
  private metadataFile: string;
  private metadataFileContents: string[];
  private metadataFileInterval?: ReturnType<typeof setInterval>;
  private cacheTimeoutMs: number;
  private lastSuccess: number = 0;
  private lastMtimeMs: number = 0;
  private state: "init" | "ready" | "expired" | "closed" = "init";

  constructor({ metadataFile, cacheTimeout, attrCache, dirCache }) {
    this.metadataFile = metadataFile;
    this.attrCache = attrCache;
    this.dirCache = dirCache;
    this.cacheTimeoutMs = cacheTimeout * 1000;
    this.init();
  }

  isReady = () => {
    return this.state == "ready";
  };

  private init = () => {
    if (this.metadataFileInterval) {
      throw Error("bug -- do not call init more than once");
    }
    this.metadataFileInterval = setInterval(
      this.update,
      METADATA_FILE_INTERVAL_MS,
    );
    this.state = "expired";
    this.update();
  };

  private update = async () => {
    // try to read the file.  It's fine it doesn't exist.
    try {
      const { mtimeMs } = await stat(this.metadataFile);
      if (Date.now() - mtimeMs >= this.cacheTimeoutMs) {
        log(
          `metadataFile: '${this.metadataFile}' is older than cache timeout -- not loading`,
        );
        this.state = "expired";
        this.metadataFileContents = [];
        return;
      }
      if (mtimeMs <= this.lastMtimeMs) {
        // it hasn't changed so nothing to do
        return;
      }
      const start = Date.now();
      this.lastMtimeMs = mtimeMs;
      let content = await readFile(this.metadataFile);
      if (this.metadataFile.endsWith(".lz4")) {
        content = decode(content);
      }
      this.metadataFileContents = content.toString().split("\0\0");
      this.metadataFileContents.sort();
      this.lastSuccess = Date.now();
      this.state = "ready";
      log(
        `metadataFile: "${this.metadataFile}" is NEW -- parsed in `,
        Date.now() - start,
        "ms",
      );
    } catch (err) {
      log(
        "metadataFile: not reading -- ",
        err.code == "ENOENT" ? `no file '${this.metadataFile}'` : err,
      );
      if (Date.now() - this.lastSuccess >= this.cacheTimeoutMs) {
        // expire the metadataFile cache contents.
        // NOTE: this could take slightly longer than cacheTimeoutMs, depending
        // on METADATA_FILE_INTERVAL_MS, but for my application I don't care.
        this.state = "expired";
        this.metadataFileContents = [];
      }
    }
  };

  close = () => {
    this.state = "closed";
    this.metadataFileContents = [];
    if (this.metadataFileInterval) {
      clearInterval(this.metadataFileInterval);
      delete this.metadataFileInterval;
    }
  };

  readdir = (path: string) => {
    if (!this.isReady()) {
      throw Error("MetadataFile is not ready");
    }
    log("readdir", path);
    let i = binarySearch(this.metadataFileContents, path, (value, find) => {
      const path = "/" + value.split("\0")[0];
      if (path < find) {
        return -1;
      }
      if (path > find) {
        return 1;
      }
      return 0;
    });
    if (i == -1) {
      log("readdir", path, " -- does not exist");
      return [];
    }
    const filenames: string[] = [];
    const pathDir = path == "/" ? path : path + "/";
    i += 1;
    while (i < this.metadataFileContents.length) {
      const v = this.metadataFileContents[i].split("\0");
      const name = "/" + v[0];
      if (!name.startsWith(path)) {
        // definitely done.
        break;
      }
      if (name.startsWith(pathDir)) {
        const filename = name.slice(pathDir.length);
        if (!filename.includes("/")) {
          filenames.push(filename);
          const data = v[1].split(" ");
          const mtime = new Date(parseFloat(data[0]) * 1000);
          const attr = {
            mtime,
            atime: new Date(parseFloat(data[1]) * 1000),
            ctime: mtime,
            blocks: parseInt(data[2]),
            size: parseInt(data[3]),
            mode: symbolicToMode(data[4]),
            flags: 0,
            uid: 0,
            gid: 0,
          };
          this.attrCache.set(join(path, filename), { attr });
        }
      }
      i += 1;
    }
    this.dirCache.set(path, filenames);
    return filenames;
  };
}
