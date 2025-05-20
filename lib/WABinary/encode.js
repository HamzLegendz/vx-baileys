"use strict";

/**
 * Utility functions for binary encoding of WhatsApp nodes.
 * @module WABinary/encode
 */

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();

Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeBinaryNode = void 0;

const constants = __importStar(require("./constants"));
const { jidDecode } = require("./jid-utils");

/**
 * Encodes a WhatsApp binary node into a Buffer.
 * @param {Object} node - The node to encode.
 * @param {Object} [opts=constants] - Encoding options (TAGS, TOKEN_MAP, etc.).
 * @param {number[]} [buffer=[0]] - Initial buffer (for recursion/internal use).
 * @returns {Buffer}
 */
const encodeBinaryNode = (node, opts = constants, buffer = [0]) => {
    const encoded = encodeBinaryNodeInner(node, opts, buffer);
    return Buffer.from(encoded);
};
exports.encodeBinaryNode = encodeBinaryNode;

/**
 * Encodes a WhatsApp binary node recursively.
 * @private
 * @param {Object} node
 * @param {Object} opts
 * @param {number[]} buffer
 * @returns {number[]}
 */
function encodeBinaryNodeInner({ tag, attrs = {}, content }, opts, buffer) {
    const { TAGS, TOKEN_MAP } = opts;

    // Byte push helpers
    const pushByte = (value) => buffer.push(value & 0xff);

    const pushInt = (value, n, littleEndian = false) => {
        for (let i = 0; i < n; i++) {
            const curShift = littleEndian ? i : n - 1 - i;
            buffer.push((value >> (curShift * 8)) & 0xff);
        }
    };

    const pushBytes = (bytes) => {
        for (const b of bytes) buffer.push(b);
    };

    const pushInt16 = (value) => {
        pushBytes([(value >> 8) & 0xff, value & 0xff]);
    };

    const pushInt20 = (value) => {
        pushBytes([(value >> 16) & 0x0f, (value >> 8) & 0xff, value & 0xff]);
    };

    // Write length of bytes (BINARY_8, BINARY_20, BINARY_32)
    const writeByteLength = (length) => {
        if (length >= 4294967296) {
            throw new Error('string too large to encode: ' + length);
        }
        if (length >= 1 << 20) {
            pushByte(TAGS.BINARY_32);
            pushInt(length, 4); // 32 bit integer
        } else if (length >= 256) {
            pushByte(TAGS.BINARY_20);
            pushInt20(length);
        } else {
            pushByte(TAGS.BINARY_8);
            pushByte(length);
        }
    };

    /**
     * Write a raw string with a length prefix.
     * @param {string} str
     */
    const writeStringRaw = (str) => {
        const bytes = Buffer.from(str, 'utf-8');
        writeByteLength(bytes.length);
        pushBytes(bytes);
    };

    /**
     * Encode a JID object.
     * @param {Object} param0
     */
    const writeJid = ({ domainType, device, user, server }) => {
        if (typeof device !== 'undefined') {
            pushByte(TAGS.AD_JID);
            pushByte(domainType || 0);
            pushByte(device || 0);
            writeString(user);
        } else {
            pushByte(TAGS.JID_PAIR);
            if (user && user.length) {
                writeString(user);
            } else {
                pushByte(TAGS.LIST_EMPTY);
            }
            writeString(server);
        }
    };

    /**
     * Packs a character to a nibble.
     * @param {string} char
     * @returns {number}
     */
    const packNibble = (char) => {
        switch (char) {
            case '-': return 10;
            case '.': return 11;
            case '\0': return 15;
            default:
                if (char >= '0' && char <= '9') {
                    return char.charCodeAt(0) - '0'.charCodeAt(0);
                }
                throw new Error(`invalid byte for nibble "${char}"`);
        }
    };

    /**
     * Packs a character to a hex value.
     * @param {string} char
     * @returns {number}
     */
    const packHex = (char) => {
        if (char >= '0' && char <= '9') {
            return char.charCodeAt(0) - '0'.charCodeAt(0);
        }
        if (char >= 'A' && char <= 'F') {
            return 10 + char.charCodeAt(0) - 'A'.charCodeAt(0);
        }
        if (char >= 'a' && char <= 'f') {
            return 10 + char.charCodeAt(0) - 'a'.charCodeAt(0);
        }
        if (char === '\0') {
            return 15;
        }
        throw new Error(`Invalid hex char "${char}"`);
    };

    /**
     * Write packed bytes (nibble or hex).
     * @param {string} str
     * @param {"nibble"|"hex"} type
     */
    const writePackedBytes = (str, type) => {
        if (str.length > TAGS.PACKED_MAX) {
            throw new Error('Too many bytes to pack');
        }
        pushByte(type === 'nibble' ? TAGS.NIBBLE_8 : TAGS.HEX_8);
        let roundedLength = Math.ceil(str.length / 2.0);
        if (str.length % 2 !== 0) {
            roundedLength |= 128;
        }
        pushByte(roundedLength);
        const packFunction = type === 'nibble' ? packNibble : packHex;
        const packBytePair = (v1, v2) => (packFunction(v1) << 4) | packFunction(v2);
        const strLengthHalf = Math.floor(str.length / 2);
        for (let i = 0; i < strLengthHalf; i++) {
            pushByte(packBytePair(str[2 * i], str[2 * i + 1]));
        }
        if (str.length % 2 !== 0) {
            pushByte(packBytePair(str[str.length - 1], '\x00'));
        }
    };

    /**
     * Checks if a string is nibble-encodable.
     * @param {string} str
     * @returns {boolean}
     */
    const isNibble = (str) => {
        if (!str || str.length > TAGS.PACKED_MAX) return false;
        for (const char of str) {
            const isInNibbleRange = char >= '0' && char <= '9';
            if (!isInNibbleRange && char !== '-' && char !== '.') return false;
        }
        return true;
    };

    /**
     * Checks if a string is hex-encodable.
     * @param {string} str
     * @returns {boolean}
     */
    const isHex = (str) => {
        if (!str || str.length > TAGS.PACKED_MAX) return false;
        for (const char of str) {
            const isInHexRange = (char >= '0' && char <= '9') || (char >= 'A' && char <= 'F');
            if (!isInHexRange) return false;
        }
        return true;
    };

    /**
     * Encode a string using token map, nibbles, hex, JID, or raw.
     * @param {string} str
     */
    const writeString = (str) => {
        if (typeof str !== "string" || !str.length) {
            writeStringRaw(""); // fallback for empty or non-string
            return;
        }
        const tokenIndex = TOKEN_MAP[str];
        if (typeof tokenIndex !== "undefined") {
            if (typeof tokenIndex.dict === 'number') {
                pushByte(TAGS.DICTIONARY_0 + tokenIndex.dict);
            }
            pushByte(tokenIndex.index);
        } else if (isNibble(str)) {
            writePackedBytes(str, 'nibble');
        } else if (isHex(str)) {
            writePackedBytes(str, 'hex');
        } else {
            // Try to encode as JID
            const decodedJid = jidDecode(str);
            if (decodedJid) {
                writeJid(decodedJid);
            } else {
                writeStringRaw(str);
            }
        }
    };

    /**
     * Starts a new list with the appropriate prefix.
     * @param {number} listSize
     */
    const writeListStart = (listSize) => {
        if (listSize === 0) {
            pushByte(TAGS.LIST_EMPTY);
        } else if (listSize < 256) {
            pushBytes([TAGS.LIST_8, listSize]);
        } else {
            pushByte(TAGS.LIST_16);
            pushInt16(listSize);
        }
    };

    // Filter out undefined/null attribute values
    const validAttributes = Object.keys(attrs).filter(k =>
        typeof attrs[k] !== 'undefined' && attrs[k] !== null
    );

    // List size: tag + 2*n attributes + content (if present)
    writeListStart(2 * validAttributes.length + 1 + (typeof content !== 'undefined' ? 1 : 0));
    writeString(tag);

    // Write attributes
    for (const key of validAttributes) {
        if (typeof attrs[key] === 'string') {
            writeString(key);
            writeString(attrs[key]);
        }
    }

    // Write content
    if (typeof content === 'string') {
        writeString(content);
    } else if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
        writeByteLength(content.length);
        pushBytes(content);
    } else if (Array.isArray(content)) {
        writeListStart(content.length);
        for (const item of content) {
            encodeBinaryNodeInner(item, opts, buffer);
        }
    } else if (typeof content === 'undefined' || content === null) {
        // do nothing
    } else {
        throw new Error(`invalid children for header "${tag}": ${content} (${typeof content})`);
    }

    return buffer;
}
