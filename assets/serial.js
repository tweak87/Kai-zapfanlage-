import { createPourRecord, parseSerialLine } from "./core.js";

export class WebSerialTransport extends EventTarget {
  constructor() {
    super();
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.keepReading = false;
  }

  static isSupported() {
    return "serial" in navigator;
  }

  async connect() {
    if (!WebSerialTransport.isSupported()) throw new Error("Web Serial wird von diesem Browser nicht unterstützt.");
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200 });
    this.keepReading = true;
    const encoder = new TextEncoderStream();
    encoder.readable.pipeTo(this.port.writable).catch(() => {});
    this.writer = encoder.writable.getWriter();
    this.dispatchEvent(new CustomEvent("connection", { detail: { connected: true } }));
    this.readLoop();
    await this.send({ type: "system.hello", client: "kai-tap-web", protocol: 1 });
  }

  async readLoop() {
    const decoder = new TextDecoderStream();
    this.port.readable.pipeTo(decoder.writable).catch(() => {});
    this.reader = decoder.readable.getReader();
    let buffer = "";
    try {
      while (this.keepReading) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = parseSerialLine(line);
            this.dispatchEvent(new CustomEvent("message", { detail: message }));
            if (message.type === "pour.completed") {
              this.dispatchEvent(new CustomEvent("pour", {
                detail: createPourRecord({ ...message, source: "serial" })
              }));
            }
          } catch (error) {
            this.dispatchEvent(new CustomEvent("protocol-error", { detail: { error, line } }));
          }
        }
      }
    } finally {
      this.reader?.releaseLock();
    }
  }

  async send(message) {
    if (!this.writer) throw new Error("Arduino ist nicht verbunden.");
    await this.writer.write(`${JSON.stringify(message)}\n`);
  }

  async disconnect() {
    this.keepReading = false;
    try { await this.reader?.cancel(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.dispatchEvent(new CustomEvent("connection", { detail: { connected: false } }));
  }
}
