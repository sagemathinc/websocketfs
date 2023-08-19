import http from "http";
import WebSocket from "ws";
import Url from "url";
import * as channel from "./channel";
import { SftpError } from "./util";
import debug from "debug";
const log = debug("websocketfs:channel-ws");

import IChannel = channel.IChannel;

export class WebSocketChannelFactory {
  constructor() {}

  connect(
    address: string,
    options: any,
    callback: (err: Error, channel?: IChannel) => any,
  ): void {
    log("connect", address, options);
    options = options || {};

    var url = Url.parse(address);
    options.username = url.auth || options.username;
    options.password = options.password || options.passphrase;
    url.auth = null;
    address = Url.format(url);

    this._connect(address, options, null, callback);
  }

  private _connect(
    address: string,
    options: any,
    credentials: string | null,
    callback: (err: Error | null, channel?: IChannel) => any,
  ): void {
    log("_connect", address, options);
    var username = options.username;
    var password = options.password;

    if (username && password) {
      credentials = getBasicAuthHeader(username, password);
    }

    if (credentials != null) {
      options.headers = options.headers || {};
      options.headers["Authorization"] = credentials;
    }

    let authenticate: string | null = null;

    log("create websocket");
    const ws = new WebSocket(address, options);
    log("create channel");
    const channel = new WebSocketChannel(ws, true, false);

    ws.on("open", () => {
      log("websocket on open");
      channel._init();
      callback(null, channel);
    });

    ws.on(
      "unexpected-response",
      (req: http.ClientRequest, res: http.IncomingMessage) => {
        log("websocket on unexpected-response");
        // abort the request
        req.abort();

        var information = res.headers["sftp-authenticate-info"];

        var message: string;
        var code = "X_NOWS";
        switch (res.statusCode) {
          case 200:
            message = "Unable to upgrade to WebSocket protocol";
            break;
          case 401:
            if (credentials == null) {
              for (var i = 0; i < res.rawHeaders.length; i += 2) {
                if (!res.rawHeaders[i].match(/^WWW-Authenticate$/i)) continue;
                if (!res.rawHeaders[i + 1].match(/^Basic realm/)) continue;

                authenticate = "Basic";
                break;
              }

              message = "Authentication required";
            } else {
              message = "Authentication failed";
            }

            code = "X_NOAUTH";
            break;
          default:
            message =
              "Unexpected server response: '" +
              res.statusCode +
              " " +
              res.statusMessage +
              "'";
            break;
        }

        var err = <any>new Error(message);
        err.code = err.errno = code;
        err.level = "http";
        if (information) err.info = information;

        channel._close(2, err);
      },
    );

    function getBasicAuthHeader(username: string, password: string): string {
      return (
        "Basic " + Buffer.from(username + ":" + password).toString("base64")
      );
    }

    channel.on("close", (err) => {
      log("websocket close", err);
      err = err || new Error("Connection closed");

      if (
        err.code === "X_NOAUTH" &&
        authenticate &&
        typeof options.authenticate === "function"
      ) {
        // prepare queries
        var queries: { name: string; prompt: string; secret: boolean }[] = [];
        if (!username)
          queries.push({
            name: "username",
            prompt: "Username:",
            secret: false,
          });
        queries.push({ name: "password", prompt: "Password:", secret: true });

        var instructions = err.info;
        var self = this;

        // invoke client authentication callback
        var auth = options.authenticate;
        if (auth.length >= 3) {
          return auth(instructions, queries, supply);
        } else {
          var result = auth(instructions, queries);
          return supply(result);
        }
      }

      function supply(values: { [name: string]: string }): void {
        values = values || {};
        if (!username) username = values["username"];
        password = values["password"];

        if (username && password) {
          // try authenticating with the supplied credentials
          credentials = getBasicAuthHeader(username, password);
          options.username = null;
          options.password = null;
          self._connect(address, options, credentials, callback);
        } else {
          // fail if no credentials supplied
          callback(err);
        }
      }

      callback(err);
    });
  }

  bind(ws: WebSocket): IChannel {
    if (ws.readyState != WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    return new WebSocketChannel(ws, true, true);
  }
}

class WebSocketChannel implements IChannel {
  private ws: WebSocket;
  private options: any;
  private established: boolean;
  private closed: boolean;
  private onclose: ((err: Error) => void) | null;

  on(event: string, listener: Function): IChannel {
    if (typeof listener !== "function")
      throw new Error("Listener must be a function");

    switch (event) {
      case "message":
        this.onmessage(<any>listener);
        break;
      case "close":
        this.onclose = <any>listener;
        break;
      default:
        break;
    }
    return this;
  }

  private onmessage(listener: (packet: Buffer) => void): void {
    this.ws.on("message", (data, isBinary: boolean) => {
      //log("received message", { data, isBinary });
      if (this.closed) {
        return;
      }

      let packet: Buffer;
      if (isBinary) {
        packet = <Buffer>data;
      } else {
        const err = new SftpError(
          "Connection failed due to unsupported packet type -- all messages must be binary",
          { code: "EFAILURE", errno: "EFAILURE", level: "ws" },
        );
        this._close(1, err);
        return;
      }

      listener(packet);
    });
  }

  constructor(ws: WebSocket, binary: boolean, established: boolean) {
    this.ws = ws;
    this.options = { binary: binary }; //WEB: this.binary = binary;
    this.established = established;

    ws.on("close", (reason, description) => {
      var message = "Connection failed";
      var code = "EFAILURE";
      switch (reason) {
        case 1000:
          return this._close(reason, null);
        case 1001:
          message = "Endpoint is going away";
          code = "X_GOINGAWAY";
          break;
        case 1002:
          message = "Protocol error";
          code = "EPROTOTYPE";
          break;
        case 1006:
          message = "Connection aborted";
          code = "ECONNABORTED";
          break;
        case 1007:
          message = "Invalid message";
          break;
        case 1008:
          message = "Prohibited message";
          break;
        case 1009:
          message = "Message too large";
          break;
        case 1010:
          message = "Connection terminated";
          code = "ECONNRESET";
          break;
        case 1011:
          message = description; //WEB: message = "Connection reset";
          code = "ECONNRESET";
          break;
        case 1015:
          message = "Unable to negotiate secure connection";
          break;
      }

      var err = <any>new Error(message);
      err.code = err.errno = code;
      err.level = "ws";
      err.nativeCode = reason;

      this._close(reason, err);
    }); //WEB: };

    ws.on("error", (err) => {
      //WEB: ws.onerror = err => {
      //WEB: this.failed = true;

      // #if NODE
      var code = (<any>err).code;

      switch (code) {
        case "HPE_INVALID_CONSTANT":
          err.message = "Server uses invalid protocol";
          (<any>err).level = "http";
          break;
        case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
          err.message =
            "Unable to verify leaf certificate (possibly due to missing intermediate CA certificate)";
          (<any>err).level = "ssl";
          break;
      }

      if (
        typeof (<any>err).code !== "undefined" &&
        typeof (<any>err).errno === "undefined"
      )
        (<any>err).errno = code;

      this._close(0, err);
      // #endif
    }); //WEB: };
  }

  _init(): void {
    this.onclose = null;
    this.established = true;
  }

  _close(_kind: number, err: Error | any): void {
    if (this.closed) return;
    var onclose = this.onclose;
    this.close();

    if (!err && !this.established) {
      err = new Error("Connection refused");
      err.code = err.errno = "ECONNREFUSED";
    }

    if (typeof onclose === "function") {
      process.nextTick(() => onclose?.(err));
    } else {
      if (err) throw err;
    }
  }

  close(reason?: number, description?: string): void {
    if (this.closed) return;
    this.closed = true;

    this.onclose = null;
    // @ts-ignore
    this.onmessage = null;

    if (!reason) reason = 1000;
    try {
      this.ws.close(reason, description);
    } catch (err) {
      // ignore errors - we are shuting down the socket anyway
    }
  }

  send(packet: Buffer): void {
    if (this.closed) return;

    try {
      this.ws.send(packet, this.options, (err) => {
        //WEB: this.ws.send(packet);
        if (err) this._close(3, err); //WEB: // removed
      }); //WEB: // removed
    } catch (err) {
      this._close(2, err);
    }
  }
}
