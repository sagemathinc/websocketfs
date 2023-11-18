/*
Each time a file is explicitly read from that we haven't
seen before, we write its name to readTrackingFile
followed by a null byte.

Everything is reset when readTrackingFile gets deleted from
disk by some external process (do that to indicate need for
a reset).
*/

import { appendFile, writeFile, stat } from "fs/promises";
import debug from "debug";
const log = debug("websocketfs:read-tracking");

export default class ReadTracking {
  private readTrackingFile: string;
  private history = new Set<string>();
  private excludeHidden: boolean;
  private excludePaths: string[];

  constructor(readTrackingFile: string, readTrackingExclude: string[]) {
    this.readTrackingFile = readTrackingFile;
    this.excludeHidden = readTrackingExclude.includes(".*");
    this.excludePaths = readTrackingExclude
      .filter((pattern) => pattern != ".*")
      .map((pattern) => {
        if (!pattern.endsWith("/")) {
          return pattern + "/";
        } else {
          return pattern;
        }
      });
    this.init();
  }

  private init = async () => {
    try {
      await writeFile(this.readTrackingFile, "");
    } catch (err) {
      log("error clearing read tracking file", this.readTrackingFile, err);
    }
  };

  trackRead = async (filename: string) => {
    filename = filename.slice(1);
    if (this.isExcluded(filename)) {
      return;
    }
    log(`trackRead`, { filename });
    try {
      await stat(this.readTrackingFile);
    } catch (_) {
      // file doesn't exist, so reset history
      this.history.clear();
    }
    if (this.history.has(filename)) {
      return;
    }
    await appendFile(this.readTrackingFile, `${filename}\0`);
    this.history.add(filename);
  };

  private isExcluded = (filename: string) => {
    if (this.excludeHidden && filename.startsWith(".")) {
      return true;
    }
    for (const pattern of this.excludePaths) {
      if (filename.startsWith(pattern)) {
        return true;
      }
    }
    return false;
  };
}
