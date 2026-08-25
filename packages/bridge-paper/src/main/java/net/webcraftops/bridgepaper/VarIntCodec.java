package net.webcraftops.bridgepaper;

import java.io.ByteArrayOutputStream;

// packages/bridge-core/src/fabric-bridge.ts의 writeVarInt와 동일한 LEB128 스타일 인코딩.
public final class VarIntCodec {
    private VarIntCodec() {}

    public static void writeVarInt(ByteArrayOutputStream out, int value) {
        int v = value;
        while ((v & ~0x7F) != 0) {
            out.write((v & 0x7F) | 0x80);
            v >>>= 7;
        }
        out.write(v);
    }
}
