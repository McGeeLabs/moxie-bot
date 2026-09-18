import { createSocket } from "node:dgram";
import { isIP } from "node:net";

export type ValheimQueryResult =
  | { status: "online"; name: string; map: string; players: number; maxPlayers: number; passwordProtected: boolean; version: string; latencyMs: number }
  | { status: "unavailable"; reason: "timeout" | "network" | "invalid_response" | "unsupported_response" | "wrong_game" };

const request = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]), Buffer.from("Source Engine Query\0")]);

// A2S_INFO is enough for this milestone: no player-name or rules requests.
export function parseInfo(packet: Buffer): Omit<Extract<ValheimQueryResult, { status: "online" }>, "latencyMs"> {
  if (packet.length < 6 || packet.readInt32LE(0) !== -1 || packet[4] !== 0x49) throw new Error("Invalid information response");
  let offset = 6; // Header, response type, and protocol version.
  const skip = (bytes: number) => {
    if (offset + bytes > packet.length) throw new Error("Truncated information response");
    offset += bytes;
  };
  const byte = () => { skip(1); return packet[offset - 1]; };
  const string = () => {
    const end = packet.indexOf(0, offset);
    if (end < 0 || end - offset > 2048) throw new Error("Invalid information string");
    const value = packet.toString("utf8", offset, end);
    offset = end + 1;
    return value;
  };
  const name = string();
  const map = string();
  const folder = string();
  string(); // Game description.
  skip(2); // Short application ID; Valheim also supplies an extended ID.
  const players = byte();
  const maxPlayers = byte();
  skip(3); // Bot count, server type, and operating system.
  const passwordProtected = byte() !== 0;
  skip(1); // Anti-cheat flag.
  let version = string();
  if (offset < packet.length) {
    const flags = byte();
    if (flags & 0x80) skip(2); // Game port.
    if (flags & 0x10) skip(8); // Steam ID.
    if (flags & 0x40) { skip(2); string(); } // Spectator endpoint.
    if (flags & 0x20) {
      const tags = string();
      // The observed Nitrado response uses g= for the game version,
      // while its basic A2S version is a placeholder such as 1.0.0.0.
      version = /(?:^|,)(?:g|v)=([^,]+)/.exec(tags)?.[1] || version;
    }
    if (flags & 0x01) skip(8); // Extended game ID.
  }
  if (folder.toLowerCase() !== "valheim") throw new Error("Not a Valheim server");
  return { status: "online", name, map, players, maxPlayers, passwordProtected, version };
}

export function queryValheim(host: string, port: number, timeoutMs = 5000): Promise<ValheimQueryResult> {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || timeoutMs < 50 || timeoutMs > 10000) {
    throw new Error("Invalid query settings");
  }
  return new Promise(resolve => {
    const socket = createSocket(isIP(host) === 6 ? "udp6" : "udp4");
    const started = Date.now();
    let done = false;
    let challenges = 0;
    const finish = (result: ValheimQueryResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* Socket may not have finished binding. */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "unavailable", reason: "timeout" }), timeoutMs);
    const send = (packet: Buffer) => {
      if (done) return;
      socket.send(packet, error => { if (error) finish({ status: "unavailable", reason: "network" }); });
    };
    socket.on("error", () => finish({ status: "unavailable", reason: "network" }));
    socket.on("message", packet => {
      if (done) return;
      if (packet.length > 8192 || packet.length < 5) return finish({ status: "unavailable", reason: "invalid_response" });
      if (packet.readInt32LE(0) === -2) return finish({ status: "unavailable", reason: "unsupported_response" });
      if (packet.readInt32LE(0) !== -1) return finish({ status: "unavailable", reason: "invalid_response" });
      if (packet[4] === 0x41) {
        if (packet.length !== 9 || ++challenges > 2) return finish({ status: "unavailable", reason: "invalid_response" });
        send(Buffer.concat([request, packet.subarray(5, 9)]));
        return;
      }
      try {
        finish({ ...parseInfo(packet), latencyMs: Date.now() - started });
      } catch (error) {
        finish({ status: "unavailable", reason: error instanceof Error && error.message === "Not a Valheim server" ? "wrong_game" : "invalid_response" });
      }
    });
    try { socket.connect(port, host, () => send(request)); }
    catch { finish({ status: "unavailable", reason: "network" }); }
  });
}
