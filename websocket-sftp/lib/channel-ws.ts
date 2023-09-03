import http from "http";
import WebSocket from "ws";
import Url from "url";
import type { IChannel } from "./channel";
import { SftpError } from "./util";
import debug from "debug";

const log = debug("websocketfs:channel-ws");

export class WebSocketChannelFactory {
  constructor() {}

  connect(
    address: string,
    options,
    callback: (err: Error, channel?: IChannel) => any,
  ): void {
    log("connect", address, options);

    const url = Url.parse(address);
    address = Url.format(url);

    this._connect(address, options, callback);
  }

  private _connect(
    address: string,
    options,
    callback: (err: Error | null, channel?: IChannel) => any,
  ): void {
    log("_connect", address, options);

    log("create websocket");
    const ws = new WebSocket(address, options);
    log("create channel");
    const channel = new WebSocketChannel(ws, true, false);
    let didOpen = false;

    ws.on("open", () => {
      didOpen = true;
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

        let message: string;
        const code = "X_NOWS";
        switch (res.statusCode) {
          case 200:
            message = "Unable to upgrade to WebSocket protocol";
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

        const err = <any>new Error(message);
        err.code = err.errno = code;
        err.level = "http";

        channel._close(2, err);
      },
    );

    channel.on("close", (err) => {
      log("websocket close", err);
      if (didOpen) {
        // makes no sense to call callback at this point, since we already
        // did with the successful open above!
        return;
      }
      callback(err ?? new Error("Connection closed"));
    });
  }

  bind(ws: WebSocket): IChannel {
    if (ws.readyState != WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    return new WebSocketChannel(ws, true, true);
  }
}

/*
TODO: Weirdness warning!  This WebSocketChannel is NOT an event emitter.  When
something does .on(event) it steals the listener.  It's very weird.
*/

class WebSocketChannel implements IChannel {
  private ws: WebSocket;
  private options: any;
  private established: boolean;
  private closed: boolean;
  private onclose: ((err: Error) => void) | null;

  on(event: string, listener): IChannel {
    if (typeof listener !== "function")
      throw new Error("Listener must be a function");

    switch (event) {
      case "message":
        this.onmessage(listener);
        break;
      case "close":
        this.onclose = listener;
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
          { code: "EFAILURE", errno: -38, level: "ws" },
        );
        this._close(1, err);
        return;
      }

      listener(packet);
    });
  }

  constructor(ws: WebSocket, binary: boolean, established: boolean) {
    this.ws = ws;
    this.options = { binary };
    this.established = established;

    ws.on("close", (reason, description) => {
      log("WebSocketChannel: ws.on.close", reason);
      let message = "Connection failed";
      let code = "EFAILURE";
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
          message = description;
          code = "ECONNRESET";
          break;
        case 1015:
          message = "Unable to negotiate secure connection";
          break;
      }

      const err = <any>new Error(message);
      err.code = err.errno = code;
      err.level = "ws";
      err.nativeCode = reason;

      this._close(reason, err);
    });

    ws.on("error", (err) => {
      const code = err.code;

      switch (code) {
        case "HPE_INVALID_CONSTANT":
          err.message = "Server uses invalid protocol";
          err.level = "http";
          break;
        case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
          err.message =
            "Unable to verify leaf certificate (possibly due to missing intermediate CA certificate)";
          err.level = "ssl";
          break;
      }

      if (typeof err.code !== "undefined" && typeof err.errno === "undefined") {
        err.errno = code;
      }

      this._close(0, err);
    });
  }

  _init(): void {
    this.onclose = null;
    this.established = true;
  }

  _close(_kind: number, err: Error | any): void {
    if (this.closed) return;
    const onclose = this.onclose;
    this.close();

    if (!err && !this.established) {
      err = new Error("Connection refused");
      err.code = err.errno = "ECONNREFUSED";
    }

    if (typeof onclose === "function") {
      onclose(err);
    } else {
      if (err) {
        throw err;
      }
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
        if (err) {
          this._close(3, err);
        }
      });
    } catch (err) {
      this._close(2, err);
    }
  }
}
