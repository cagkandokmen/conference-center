/**
 * rtp.js — Minimal RTP packet parser and builder.
 *
 * RTP Header (RFC 3550):
 *  0                   1                   2                   3
 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |V=2|P|X|  CC   |M|     PT      |       sequence number         |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                           timestamp                           |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |           synchronization source (SSRC) identifier           |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 */

const RTP_HEADER_SIZE = 12;

/**
 * Parse an RTP packet buffer.
 * @param {Buffer} buf
 * @returns {{ sequenceNumber, timestamp, ssrc, payloadType, payload }}
 */
function parseRtp(buf) {
  if (buf.length < RTP_HEADER_SIZE) return null;

  const version = (buf[0] >> 6) & 0x03;
  if (version !== 2) return null; // Not RTP

  const hasPadding = (buf[0] & 0x20) !== 0;
  const hasExtension = (buf[0] & 0x10) !== 0;
  const csrcCount = buf[0] & 0x0f;

  const payloadType = buf[1] & 0x7f;
  const sequenceNumber = buf.readUInt16BE(2);
  const timestamp = buf.readUInt32BE(4);
  const ssrc = buf.readUInt32BE(8);

  let offset = RTP_HEADER_SIZE + (csrcCount * 4);
  if (offset > buf.length) return null;

  if (hasExtension) {
    if (offset + 4 > buf.length) return null;
    const extLen = buf.readUInt16BE(offset + 2);
    offset += 4 + (extLen * 4);
    if (offset > buf.length) return null;
  }

  let paddingLen = 0;
  if (hasPadding) {
    paddingLen = buf[buf.length - 1];
    if (paddingLen === 0 || offset + paddingLen > buf.length) return null;
  }

  const payload = buf.subarray(offset, buf.length - paddingLen);

  return { sequenceNumber, timestamp, ssrc, payloadType, payload };
}

/**
 * Build a minimal RTP packet.
 * @param {{ payloadType, sequenceNumber, timestamp, ssrc, payload: Buffer }} opts
 * @returns {Buffer}
 */
function buildRtp({ payloadType, sequenceNumber, timestamp, ssrc, payload }) {
  const buf = Buffer.alloc(RTP_HEADER_SIZE + payload.length);

  buf[0] = 0x80;                              // V=2, P=0, X=0, CC=0
  buf[1] = payloadType & 0x7f;               // M=0, PT
  buf.writeUInt16BE(sequenceNumber & 0xffff, 2);
  buf.writeUInt32BE(timestamp >>> 0, 4);
  buf.writeUInt32BE(ssrc >>> 0, 8);
  payload.copy(buf, RTP_HEADER_SIZE);

  return buf;
}

module.exports = { parseRtp, buildRtp };
