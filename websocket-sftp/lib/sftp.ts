import http from "http";
import path from "path";
import events from "events";
import { SftpClient, ISftpClientEvents } from "./sftp-client";
import { SftpServerSession } from "./sftp-server";
import { SafeFilesystem } from "./fs-safe";
import * as local from "./fs-local";
import * as api from "./fs-api";
import { Task } from "./fs-plus";
import { FileUtil } from "./fs-misc";
import { CloseReason, IChannel as IChannel0 } from "./channel";
import { WebSocketChannelFactory } from "./channel-ws";
import * as channel_ws from "./channel-ws";
import * as channel_stream from "./channel-stream";
import * as util from "./util";
import {
  Server as WebSocketServer,
  IServerOptions as WebSocketIServerOptions,
} from "ws";
import type { WebSocket } from "ws";
import debug from "debug";

const log = debug("websocketfs-sftp:sftp");

module SFTP {
  export interface IStats extends api.IStats {}
  export interface IItem extends api.IItem {}
  export interface IFilesystem extends api.IFilesystem {}
  export interface ILogWriter extends util.ILogWriter {}

  export enum RenameFlags {
    OVERWRITE = <number>api.RenameFlags.OVERWRITE,
  }

  export interface IClientOptions {
    log?: ILogWriter | any;
    protocol?: string;
    promise?: Function;
    agent?: http.Agent;
    headers?: { [key: string]: string };
    protocolVersion?: any;
    host?: string;
  }

  export class Client extends SftpClient implements ISftpClientEvents<Client> {
    on(event: string, listener) {
      return super.on(event, listener);
    }

    once(event: string, listener) {
      return super.on(event, listener);
    }

    constructor() {
      const localFs = new local.LocalFilesystem();
      super(localFs);
    }

    connect(
      address: string,
      options?: IClientOptions,
      callback?: (err: Error | null) => void,
    ): Task<void> {
      log("Client.connect", address, options);
      if (typeof callback === "undefined" && typeof options === "function") {
        callback = <any>options;
        options = undefined;
      }

      return super._task(callback, (callback) => {
        options = options ?? {};

        if (options.protocol == null) {
          options.protocol = "sftp";
        }

        this._promise = options.promise;

        log("Client.connect: connect factory...");
        const factory = new WebSocketChannelFactory();
        factory.connect(address, options, (err, channel) => {
          if (err) {
            log("Client.connect WebSocketChannelFactory, failed ", err);
            return callback(err);
          }
          if (channel == null) {
            throw Error("bug");
          }
          log("Client.connect WebSocketChannelFactory, connected");

          super._bind(channel, options, callback);
        });
      });
    }
  }

  export const LocalFilesystem = local.LocalFilesystem;

  export interface IChannel extends IChannel0 {}

  export module Internals {
    export const StreamChannel = channel_stream.StreamChannel;
    export const WebSocketChannelFactory = channel_ws.WebSocketChannelFactory;
    export const LogHelper = util.LogHelper;
  }

  export class RequestInfo {
    origin: string;
    secure: boolean;
    req: http.ClientRequest;
  }

  export interface ISessionInfo {
    filesystem?: IFilesystem;
    virtualRoot?: string;
    readOnly?: boolean;
    hideUidGid?: boolean;
  }

  export interface IServerOptions extends WebSocketIServerOptions {
    filesystem?: IFilesystem;
    virtualRoot?: string;
    readOnly?: boolean;
    hideUidGid?: boolean;

    log?: ILogWriter | any;

    // use a provided WebSocketServer instead of the one created with the options below.
    wss?: WebSocketServer;

    // options for WebSocket server
    noServer?: boolean;
    host?: string;
    port?: number;
    server?: http.Server;
    handleProtocols?: any;
    path?: string;
    disableHixie?: boolean;
    clientTracking?: boolean;
  }

  export class Server extends events.EventEmitter {
    private _wss: WebSocketServer;
    private _sessionInfo: IServerOptions;
    private _log: ILogWriter;

    constructor(options?: IServerOptions) {
      super();

      options = options || {};
      const serverOptions: WebSocketIServerOptions = {};

      let virtualRoot = options.virtualRoot;
      let filesystem = options.filesystem;
      this._log = util.LogHelper.toLogWriter(options.log);
      const { noServer, wss } = options;

      serverOptions.handleProtocols = this.handleProtocols;

      for (const option in options) {
        if (options.hasOwnProperty(option)) {
          switch (option) {
            case "filesystem":
            case "virtualRoot":
            case "readOnly":
            case "hideUidGid":
            case "log":
              break;
            default:
              serverOptions[option] = options[option];
              break;
          }
        }
      }

      if (typeof virtualRoot === "undefined") {
        virtualRoot = process.cwd();
      } else {
        virtualRoot = path.resolve(virtualRoot);
      }

      if (typeof filesystem === "undefined") {
        filesystem = new local.LocalFilesystem();
      }

      this._sessionInfo = {
        filesystem,
        virtualRoot,
        readOnly: true && options.readOnly,
        hideUidGid: true && options.hideUidGid,
      };

      if (!noServer) {
        log("Creating WebSocketServer");
        this._wss = wss ?? new WebSocketServer(serverOptions);
        this._wss.on("error", console.error);
        this._wss.on("connection", (ws, upgradeReq) => {
          log("WebSocketServer received a new connection");
          ws.upgradeReq = upgradeReq;
          this.accept(ws, (err, _session) => {
            if (err) {
              log("WebSocketServer: error while accepting connection", err);
            } else {
              log("WebSocketServer: accept connection and created session");
            }
          });
        });
        log("SFTP server started");
      }
    }

    private handleProtocols(
      protocols: string[],
      callback: (result: boolean, protocol?: string) => void,
    ): void {
      for (let i = 0; i < protocols.length; i++) {
        const protocol = protocols[i];
        switch (protocol) {
          case "sftp":
            callback(true, protocol);
            return;
        }
      }

      callback(false);
    }

    end() {
      if (this._wss != null) {
        const count = this._wss.clients.size;
        if (count > 0) {
          this._log.debug("Stopping %d SFTP sessions ...", count);

          // end all active sessions
          for (const ws of this._wss.clients) {
            const session = <SftpServerSession>(<any>ws).session;
            if (typeof session === "object") {
              session.end();
              delete (<any>ws).session;
            }
          }
        }

        // stop accepting connections
        this._wss.close();
        delete this._wss;

        this._log.info("SFTP server stopped");
      }
    }

    accept(
      ws: WebSocket,
      callback?: (err: Error | null, session?: SftpServerSession) => void,
    ): void {
      try {
        const sessionInfo = this._sessionInfo;
        log("accept", sessionInfo);

        let virtualRoot = sessionInfo.virtualRoot;
        if (virtualRoot == null) {
          throw Error("virtualRoot must not be null");
        }
        if (sessionInfo.filesystem == null) {
          throw Error("sessionInfo.filesystem must not be null");
        }

        const fs = new SafeFilesystem(
          sessionInfo.filesystem,
          virtualRoot,
          sessionInfo,
        );

        fs.stat(".", (err, attrs) => {
          try {
            if (!err && !FileUtil.isDirectory(attrs ?? {})) {
              err = new Error("Not a directory");
            }

            if (err) {
              const message = "Unable to access file system";
              log(message, { root: virtualRoot });
              ws.close(CloseReason.UNEXPECTED_CONDITION, message);
              callback?.(err);
              return;
            }

            const factory = new WebSocketChannelFactory();
            const channel = factory.bind(ws);

            const socket = ws.upgradeReq.connection;
            const info = {
              clientAddress: socket.remoteAddress,
              clientPort: socket.remotePort,
              clientFamily: socket.remoteFamily,
              serverAddress: socket.localAddress,
              serverPort: socket.localPort,
            };

            const session = new SftpServerSession(
              channel,
              fs,
              this,
              this._log,
              info,
            );
            this.emit("startedSession", this);
            (<any>ws).session = session;
            callback?.(null, session);
          } catch (err) {
            callback?.(err);
          }
        });
      } catch (err) {
        process.nextTick(() => callback?.(err));
      }
    }
  }
}

export = SFTP;
