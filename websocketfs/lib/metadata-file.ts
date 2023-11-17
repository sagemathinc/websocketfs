import debug from "debug";
import { stat, readFile } from "fs/promises";
import binarySearch from "binarysearch";
import { symbolicToMode, readFileLz4 } from "./util";
import { watch } from "chokidar";
import { delay } from "awaiting";

const log = debug("websocketfs:metadata-file");
const log_cache = debug("cache");

export class MetadataFile {
  private attrCache;
  private dirCache;
  private metadataFile: string;
  private metadataFileContents: string[];
  private watcher?;
  private lastMtimeMs: number = 0;
  private state: "init" | "ready" | "expired" | "closed" = "init";

  constructor({ metadataFile, attrCache, dirCache }) {
    this.metadataFile = metadataFile;
    this.attrCache = attrCache;
    this.dirCache = dirCache;
    this.init();
  }

  isReady = () => {
    return this.state == "ready";
  };

  private init = async () => {
    // We keep trying util we succesfully
    // read the file once.
    while (!(await this.update())) {
      await delay(3000);
    }
    // Only after reading the file, do we setup the watcher.
    // Why? Because we might want to put the file itself inside
    // of the websocketfs filesystem, and if we try to watch too
    // soon then it doesn't work.  Subtle.
    this.watcher = watch(this.metadataFile);
    this.watcher.on("change", this.update);
    this.watcher.on("add", this.update);
    this.state = "expired";
    this.update();
  };

  private update = async () => {
    // try to read the file.  It's fine it doesn't exist.
    try {
      const { mtimeMs } = await stat(this.metadataFile);
      if (mtimeMs <= this.lastMtimeMs) {
        log("metadataFile:", this.metadataFile, "- no change");
        // it hasn't changed so nothing to do
        return false;
      }
      const start = Date.now();
      this.lastMtimeMs = mtimeMs;
      let content = await readFile(this.metadataFile);
      if (this.metadataFile.endsWith(".lz4")) {
        // We use a stream instead of blocking and using
        // lz4's decode because there  is a HUGE bug in
        // the sync api of lz4 --
        //    https://github.com/pierrec/node-lz4/issues/117
        content = await readFileLz4(this.metadataFile);
      }
      this.metadataFileContents = content.toString().split("\0\0");
      this.metadataFileContents.sort();
      this.state = "ready";
      log(
        "metadataFile:",
        this.metadataFile,
        `CHANGED - ${this.metadataFileContents.length} files - parsed in `,
        Date.now() - start,
        "ms",
      );
      return true;
    } catch (err) {
      log(
        "metadataFile:",
        this.metadataFile,
        " - non-fatal issue reading - ",
        err.code == "ENOENT"
          ? `no file '${this.metadataFile}' -- NOT updating`
          : err,
      );
      return false;
    }
  };

  close = () => {
    this.state = "closed";
    this.metadataFileContents = [];
    this.watcher?.close();
  };

  private find = (path: string): number => {
    return binarySearch(
      this.metadataFileContents,
      path,
      (value: string, find: string) => {
        const name = "/" + value.split("\0")[0];
        if (name < find) {
          return -1;
        }
        if (name > find) {
          return 1;
        }
        return 0;
      },
    );
  };

  private cacheAttrs = (i: number) => {
    const v = this.metadataFileContents[i]?.split("\0");
    if (v == null || v.length <= 1) {
      return { errno: -2 };
    }
    const data = v[1].split(" ");
    // note that we intentionally use parseInt and throw away info
    // that might be in the file.  This is for consistency with
    // the non-cached version of things.
    const mtime = new Date(parseInt(data[0]) * 1000);
    const attr = {
      mtime,
      atime: new Date(parseInt(data[1]) * 1000),
      ctime: mtime,
      blocks: parseInt(data[2]),
      size: parseInt(data[3]),
      mode: symbolicToMode(data[4]),
      flags: 0,
      uid: 0,
      gid: 0,
    };
    this.attrCache.set("/" + v[0], { attr });
    return { attr };
  };

  getattr = (path: string): { errno?: number; attr? } => {
    const i = this.find(path);
    if (i == -1) {
      // error -- no such file
      return { errno: -2 };
    } else {
      return this.cacheAttrs(i);
    }
  };

  readdir = (path: string) => {
    if (!this.isReady()) {
      throw Error("MetadataFile is not ready");
    }
    log("readdir", path);
    let i = this.find(path);
    if (i == -1) {
      log_cache("readdir ", path, " WORKED");
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
        // done.
        break;
      }
      if (name.startsWith(pathDir)) {
        const filename = name.slice(pathDir.length);
        if (!filename.includes("/")) {
          filenames.push(filename);
          this.cacheAttrs(i);
        }
      }
      i += 1;
    }
    this.dirCache.set(path, filenames);
    log_cache("readdir ", path, " WORKED");
    return filenames;
  };
}
