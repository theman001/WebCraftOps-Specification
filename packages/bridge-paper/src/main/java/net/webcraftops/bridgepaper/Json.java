package net.webcraftops.bridgepaper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// 의존성 없는 최소 JSON 파서/이스케이퍼. /bridge/command 요청 바디 파싱 전용으로,
// 필요한 만큼만 구현한다(ponytail: 범용 JSON 라이브러리를 새 의존성으로 끌어오지 않음).
public final class Json {
    private final String src;
    private int pos;

    private Json(String src) {
        this.src = src;
        this.pos = 0;
    }

    public static Object parse(String text) {
        Json parser = new Json(text);
        parser.skipWhitespace();
        Object value = parser.parseValue();
        return value;
    }

    private Object parseValue() {
        char c = peek();
        switch (c) {
            case '{':
                return parseObject();
            case '[':
                return parseArray();
            case '"':
                return parseString();
            case 't':
                expect("true");
                return Boolean.TRUE;
            case 'f':
                expect("false");
                return Boolean.FALSE;
            case 'n':
                expect("null");
                return null;
            default:
                return parseNumber();
        }
    }

    private Map<String, Object> parseObject() {
        Map<String, Object> map = new LinkedHashMap<>();
        pos++; // {
        skipWhitespace();
        if (peek() == '}') {
            pos++;
            return map;
        }
        for (;;) {
            skipWhitespace();
            String key = parseString();
            skipWhitespace();
            if (peek() != ':') {
                throw new IllegalArgumentException("JSON 파싱 오류: ':' 필요, 위치 " + pos);
            }
            pos++;
            skipWhitespace();
            Object value = parseValue();
            map.put(key, value);
            skipWhitespace();
            char c = peek();
            if (c == ',') {
                pos++;
                continue;
            }
            if (c == '}') {
                pos++;
                break;
            }
            throw new IllegalArgumentException("JSON 파싱 오류: ',' 또는 '}' 필요, 위치 " + pos);
        }
        return map;
    }

    private List<Object> parseArray() {
        List<Object> list = new ArrayList<>();
        pos++; // [
        skipWhitespace();
        if (peek() == ']') {
            pos++;
            return list;
        }
        for (;;) {
            skipWhitespace();
            list.add(parseValue());
            skipWhitespace();
            char c = peek();
            if (c == ',') {
                pos++;
                continue;
            }
            if (c == ']') {
                pos++;
                break;
            }
            throw new IllegalArgumentException("JSON 파싱 오류: ',' 또는 ']' 필요, 위치 " + pos);
        }
        return list;
    }

    private String parseString() {
        if (peek() != '"') {
            throw new IllegalArgumentException("JSON 파싱 오류: 문자열 필요, 위치 " + pos);
        }
        pos++;
        StringBuilder sb = new StringBuilder();
        for (;;) {
            char c = src.charAt(pos++);
            if (c == '"') {
                break;
            }
            if (c == '\\') {
                char esc = src.charAt(pos++);
                switch (esc) {
                    case '"':
                        sb.append('"');
                        break;
                    case '\\':
                        sb.append('\\');
                        break;
                    case '/':
                        sb.append('/');
                        break;
                    case 'n':
                        sb.append('\n');
                        break;
                    case 't':
                        sb.append('\t');
                        break;
                    case 'r':
                        sb.append('\r');
                        break;
                    case 'b':
                        sb.append('\b');
                        break;
                    case 'f':
                        sb.append('\f');
                        break;
                    case 'u':
                        String hex = src.substring(pos, pos + 4);
                        sb.append((char) Integer.parseInt(hex, 16));
                        pos += 4;
                        break;
                    default:
                        throw new IllegalArgumentException("JSON 파싱 오류: 알 수 없는 escape " + esc);
                }
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private Double parseNumber() {
        int start = pos;
        while (pos < src.length() && "-+.eE0123456789".indexOf(src.charAt(pos)) >= 0) {
            pos++;
        }
        return Double.parseDouble(src.substring(start, pos));
    }

    private void expect(String literal) {
        if (!src.startsWith(literal, pos)) {
            throw new IllegalArgumentException("JSON 파싱 오류: '" + literal + "' 필요, 위치 " + pos);
        }
        pos += literal.length();
    }

    private char peek() {
        return src.charAt(pos);
    }

    private void skipWhitespace() {
        while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) {
            pos++;
        }
    }

    public static String escape(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }
}
