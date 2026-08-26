package net.webcraftops.bridgepaper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

// System.out/System.err을 감싸 완성된 한 줄이 나올 때마다 SseBroadcaster로 전달하면서,
// 원래 스트림(콘솔/파일 로그)에도 그대로 흘려보낸다.
public final class TeeOutputStream extends OutputStream {
    private final OutputStream original;
    private final SseBroadcaster broadcaster;
    private final ByteArrayOutputStream lineBuffer = new ByteArrayOutputStream();

    public TeeOutputStream(OutputStream original, SseBroadcaster broadcaster) {
        this.original = original;
        this.broadcaster = broadcaster;
    }

    @Override
    public synchronized void write(int b) throws IOException {
        original.write(b);
        accumulate((byte) b);
    }

    @Override
    public synchronized void write(byte[] b, int off, int len) throws IOException {
        original.write(b, off, len);
        for (int i = off; i < off + len; i++) {
            accumulate(b[i]);
        }
    }

    @Override
    public void flush() throws IOException {
        original.flush();
    }

    private void accumulate(byte b) {
        if (b == '\n') {
            if (lineBuffer.size() > 0) {
                broadcaster.broadcast(lineBuffer.toString(StandardCharsets.UTF_8));
                lineBuffer.reset();
            }
        } else if (b != '\r') {
            lineBuffer.write(b);
        }
    }
}
