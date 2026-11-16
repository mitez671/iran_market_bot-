package io.github.mitez671.iranmarket;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String INDEX = "https://" + HOST + "/index.html";
    private static final int SAVE_PROMPT = 1;
    private static final String CSP = "default-src 'none'; script-src 'self'; "
            + "style-src 'self' 'unsafe-inline'; connect-src 'self'; "
            + "img-src 'self' data:; base-uri 'none'; form-action 'none'; object-src 'none'";
    private final MarketNetwork network = new MarketNetwork();
    private WebView page;
    private String promptToSave;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        page = new WebView(this);
        page.getSettings().setJavaScriptEnabled(true);
        page.getSettings().setDomStorageEnabled(true);
        page.getSettings().setAllowFileAccess(false);
        page.getSettings().setAllowContentAccess(false);
        page.setWebChromeClient(new WebChromeClient());
        page.addJavascriptInterface(new DashboardBridge(), "AndroidDashboard");
        page.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (INDEX.equals(url.toString())) return false;
                if (request.isForMainFrame() && request.hasGesture() && isWebUrl(url) && !isLocal(url)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, url));
                    } catch (ActivityNotFoundException e) {
                        toast("مرورگری برای باز کردن لینک پیدا نشد.");
                    }
                }
                return true;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!isLocal(url) || !"GET".equals(request.getMethod())) return textResponse(403, "Blocked");
                String path = url.getPath();
                if (path == null) return textResponse(404, "Not found");
                if (!request.isForMainFrame() && path.matches("/native/[0-9a-f-]{36}")) {
                    return network.take(path.substring("/native/".length()));
                }
                String mime;
                if ("/index.html".equals(path)) mime = "text/html";
                else if (path.matches("/js/[a-z]+\\.js")) mime = "text/javascript";
                else if (path.matches("/css/[a-z]+\\.css")) mime = "text/css";
                else return textResponse(404, "Not found");
                try {
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK",
                            assetHeaders(),
                            getAssets().open(path.substring(1)));
                } catch (IOException e) {
                    return textResponse(404, "Not found");
                }
            }
        });
        setContentView(page);
        page.loadUrl(INDEX);
    }

    private static Map<String, String> assetHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", CSP);
        headers.put("Cache-Control", "no-store");
        return headers;
    }

    private static boolean isWebUrl(Uri url) {
        return "https".equals(url.getScheme()) || "http".equals(url.getScheme());
    }

    private static boolean isLocal(Uri url) {
        return "https".equals(url.getScheme()) && HOST.equals(url.getAuthority());
    }

    static WebResourceResponse textResponse(int code, String message) {
        return new WebResourceResponse("text/plain", "UTF-8", code, message,
                Collections.singletonMap("Cache-Control", "no-store"),
                new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    public final class DashboardBridge {
        @JavascriptInterface public String prepare(String request) {
            try {
                return network.prepare(request);
            } catch (JSONException | IllegalArgumentException e) {
                return "";
            }
        }

        @JavascriptInterface public void cancel(String id) {
            network.cancel(id);
        }

        @JavascriptInterface public void copyPrompt(String text) {
            runOnUiThread(() -> {
                ClipboardManager clipboard = getSystemService(ClipboardManager.class);
                clipboard.setPrimaryClip(ClipData.newPlainText("Claude", text));
            });
        }

        @JavascriptInterface public void savePrompt(String filename, String text) {
            runOnUiThread(() -> {
                if (promptToSave != null) return;
                promptToSave = text;
                Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("text/markdown")
                        .putExtra(Intent.EXTRA_TITLE, filename);
                try {
                    startActivityForResult(save, SAVE_PROMPT);
                } catch (ActivityNotFoundException e) {
                    promptToSave = null;
                    toast("انتخاب محل ذخیره در دسترس نیست.");
                }
            });
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SAVE_PROMPT) return;
        String text = promptToSave;
        promptToSave = null;
        if (resultCode != RESULT_OK || data == null || data.getData() == null || text == null) return;
        try (OutputStream file = getContentResolver().openOutputStream(data.getData())) {
            if (file == null) throw new IOException("Cannot open document");
            file.write(text.getBytes(StandardCharsets.UTF_8));
            toast("پرامپت ذخیره شد.");
        } catch (IOException | SecurityException e) {
            toast("ذخیرهٔ پرامپت انجام نشد.");
        }
    }

    @Override protected void onDestroy() {
        page.removeJavascriptInterface("AndroidDashboard");
        page.destroy();
        network.close();
        super.onDestroy();
    }
}
