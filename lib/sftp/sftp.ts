import http = require("http");
import path = require("path");
import events = require("events");
import client = require("./sftp-client");
import server = require("./sftp-server");
import safe = require("./fs-safe");
import local = require("./fs-local");
import api = require("./fs-api");
import plus = require("./fs-plus");
import misc = require("./fs-misc");
import channel = require("./channel");
import channel_ws = require("./channel-ws");
import channel_stream = require("./channel-stream");
import util = require("./util");

import debug from "debug";
const log = debug("websocketfs:sftp");

import SafeFilesystem = safe.SafeFilesystem;
import WebSocketChannelFactory = channel_ws.WebSocketChannelFactory;
import CloseReason = channel.CloseReason;
import SftpServerSession = server.SftpServerSession;
import FileUtil = misc.FileUtil;
import Task = plus.Task;
import SftpClient = client.SftpClient;
import ISftpClientEvents = client.ISftpClientEvents;

import {
  Server as WebSocketServer,
  IServerOptions as WebSocketIServerOptions,
} from "ws";
import type { WebSocket } from "ws";

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

  export var LocalFilesystem = local.LocalFilesystem;

  export interface IChannel extends channel.IChannel {}

  export module Internals {
    export var StreamChannel = channel_stream.StreamChannel;
    export var WebSocketChannelFactory = channel_ws.WebSocketChannelFactory;
    export var LogHelper = util.LogHelper;
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

    // options for WebSocket server
    host?: string;
    port?: number;
    server?: http.Server;
    handleProtocols?: any;
    path?: string;
    noServer?: boolean;
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
      var serverOptions: WebSocketIServerOptions = {};

      var virtualRoot = options.virtualRoot;
      var filesystem = options.filesystem;
      this._log = util.LogHelper.toLogWriter(options.log);
      var noServer = options.noServer;

      serverOptions.handleProtocols = this.handleProtocols;

      for (var option in options) {
        if ((<Object>options).hasOwnProperty(option)) {
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
        // TODO: serve a dummy filesystem in this case to prevent revealing any files accidently
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

      // TODO: when no _fs and no _virtualRoot is specified, serve a dummy filesystem as well

      if (!noServer) {
        log("Creating WebSocketServer");
        this._wss = new WebSocketServer(serverOptions);
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
      if (typeof this._wss === "object") {
        const count = this._wss.clients.length;
        if (count > 0) {
          this._log.debug("Stopping %d SFTP sessions ...", count);

          // end all active sessions
          this._wss.clients.forEach((ws) => {
            const session = <SftpServerSession>(<any>ws).session;
            if (typeof session === "object") {
              session.end();
              delete (<any>ws).session;
            }
          });
        }

        // stop accepting connections
        this._wss.close();

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

        const virtualRoot = sessionInfo.virtualRoot;
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
