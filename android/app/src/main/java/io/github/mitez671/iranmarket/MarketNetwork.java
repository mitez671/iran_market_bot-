package io.github.mitez671.iranmarket;

import android.webkit.WebResourceResponse;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.FilterInputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

final class MarketNetwork {
    private final Map<String, JSONObject> pending = new ConcurrentHashMap<>();
    private final Map<String, okhttp3.Call> active = new ConcurrentHashMap<>();
    private final OkHttpClient client = new OkHttpClient.Builder()
            .dns(MarketNetwork::publicAddresses)
            .proxy(Proxy.NO_PROXY)
            .followRedirects(false)
            .followSslRedirects(false)
            .build();

    String prepare(String descriptor) throws JSONException {
        if (descriptor.length() > 2_000_000 || pending.size() >= 256) {
            throw new IllegalArgumentException("Request limit exceeded");
        }
        String id = UUID.randomUUID().toString();
        pending.put(id, new JSONObject(descriptor));
        return id;
    }

    void cancel(String id) {
        pending.remove(id);
        okhttp3.Call call = active.remove(id);
        if (call != null) call.cancel();
    }

    void close() {
        pending.clear();
        client.dispatcher().cancelAll();
        client.connectionPool().evictAll();
    }

    WebResourceResponse take(String id) {
        JSONObject data = pending.remove(id);
        if (data == null) return MainActivity.textResponse(404, "Request expired");
        try {
            return execute(id, data);
        } catch (IOException | JSONException | IllegalArgumentException e) {
            active.remove(id);
            return new WebResourceResponse("text/plain", "UTF-8", 502, "Network request failed",
                    Collections.singletonMap("X-Dashboard-Network-Error", "1"),
                    new java.io.ByteArrayInputStream(new byte[0]));
        }
    }

    private WebResourceResponse execute(String id, JSONObject data) throws IOException, JSONException {
        HttpUrl url = HttpUrl.parse(data.getString("url"));
        String method = data.getString("method");
        if (!"GET".equals(method) && !"POST".equals(method)) {
            throw new IllegalArgumentException("Unsupported method");
        }
        String payload = data.optString("body", "");
        JSONObject headers = data.getJSONObject("headers");
        int timeout = Math.max(1000, Math.min(data.getInt("timeout"), 120000));
        OkHttpClient timedClient = client.newBuilder().callTimeout(timeout, TimeUnit.MILLISECONDS).build();

        for (int hop = 0; hop < 6; hop++) {
            validate(url);
            Request.Builder request = new Request.Builder().url(url)
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36")
                    .header("Accept", "*/*")
                    .header("Accept-Language", "fa-IR,fa;q=0.9,en;q=0.5")
                    .header("Referer", referer(url));
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (key.matches("(?i)content-type|accept|x-api-key|anthropic-version|anthropic-dangerous-direct-browser-access")) {
                    request.header(key, headers.getString(key));
                }
            }
            if ("POST".equals(method)) {
                request.post(RequestBody.create(MediaType.parse(headers.optString("content-type", "application/json")), payload));
            }
            okhttp3.Call call = timedClient.newCall(request.build());
            active.put(id, call);
            Response response = call.execute();
            int code = response.code();
            String location = response.header("Location");
            if ((code == 301 || code == 302 || code == 303 || code == 307 || code == 308) && location != null) {
                HttpUrl next = url.resolve(location);
                response.close();
                active.remove(id, call);
                validate(next);
                boolean sameOrigin = url.host().equals(next.host()) && url.scheme().equals(next.scheme());
                if (!sameOrigin && ("POST".equals(method) || headers.has("x-api-key"))) {
                    throw new IOException("Cross-origin credential redirect");
                }
                if (code == 303 || code == 301 || code == 302) method = "GET";
                url = next;
                continue;
            }
            if (code >= 300 && code < 400 || response.body() == null) {
                response.close();
                active.remove(id, call);
                return MainActivity.textResponse(502, "Unexpected source response");
            }
            MediaType type = response.body().contentType();
            String encoding = type == null || type.charset() == null ? "UTF-8" : type.charset().name();
            FilterInputStream stream = new FilterInputStream(response.body().byteStream()) {
                @Override public void close() {
                    response.close();
                    active.remove(id, call);
                }
            };
            return new WebResourceResponse("text/plain", encoding, code, code < 300 ? "OK" : "Source error",
                    Collections.singletonMap("Cache-Control", "no-store"), stream);
        }
        throw new IOException("Too many redirects");
    }

    private static void validate(HttpUrl url) {
        if (url == null || !url.username().isEmpty() || !url.password().isEmpty()
                || url.port() != HttpUrl.defaultPort(url.scheme())
                || (!url.isHttps() && !"old.tsetmc.com".equals(url.host()))) {
            throw new IllegalArgumentException("Unsupported source URL");
        }
    }

    private static String referer(HttpUrl url) {
        String host = url.host();
        if (host.equals("tsetmc.com") || host.endsWith(".tsetmc.com")) return "https://www.tsetmc.com/";
        if (host.equals("tgju.org") || host.endsWith(".tgju.org")) return "https://www.tgju.org/";
        return url.scheme() + "://" + host + "/";
    }

    private static List<InetAddress> publicAddresses(String host) throws UnknownHostException {
        List<InetAddress> addresses = Dns.SYSTEM.lookup(host);
        for (InetAddress address : addresses) {
            byte[] bytes = address.getAddress();
            int first = bytes[0] & 255;
            int second = bytes[1] & 255;
            boolean restricted = bytes.length == 4
                    ? first == 0 || first >= 224 || (first == 100 && second >= 64 && second < 128)
                    : (first & 0xe0) != 0x20;
            if (restricted || address.isAnyLocalAddress() || address.isLoopbackAddress()
                    || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress()) {
                throw new UnknownHostException("Non-public address");
            }
        }
        return addresses;
    }
}
