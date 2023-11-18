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

  constructor(readTrackingFile) {
    this.readTrackingFile = readTrackingFile;
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
    log(`fileWasRead`, { filename });
    try {
      await stat(this.readTrackingFile);
    } catch (_) {
      // file doesn't exist, so reset history
      this.history.clear();
    }
    if (this.history.has(filename)) {
      return;
    }
    await appendFile(this.readTrackingFile, `${filename.slice(1)}\0`);
    this.history.add(filename);
  };
}
