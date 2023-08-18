import { Client as SftpClient } from "../sftp/sftp";
import { callback } from "awaiting";
import debug from "debug";

const log = debug("websocketfs:fuse:sftp");

export default class SftpFuse {
  private remote: string;
  private sftp: SftpClient;

  constructor(remote: string) {
    this.remote = remote;
    this.sftp = new SftpClient();
  }

  async connect() {
    log("connecting to ", this.remote);
    await callback(this.sftp.connect, this.remote, {});
  }

  getFuseOperations() {
    return {
      init: (cb) => {
        log("Filesystem init");
        cb();
      },

      access: (path, mode, cb) => {
        log("access", { path, mode });
        cb();
      },
    };
  }
}
